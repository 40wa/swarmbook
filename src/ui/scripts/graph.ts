export const graphScript = `
(function () {
  var ASSET = '/assets/force-graph-1.51.4.min.js';
  var libraryPromise = null;
  var graph = null;
  var graphContainer = null;
  var resizeObserver = null;
  var themeObserver = null;

  function loadLibrary() {
    if (window.ForceGraph) return Promise.resolve(window.ForceGraph);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-force-graph]');
      var script = existing || document.createElement('script');
      script.addEventListener('load', function () {
        if (window.ForceGraph) resolve(window.ForceGraph);
        else reject(new Error('ForceGraph did not initialise'));
      }, { once: true });
      script.addEventListener('error', function () {
        reject(new Error('Could not load ForceGraph'));
      }, { once: true });
      if (!existing) {
        script.src = ASSET;
        script.defer = true;
        script.dataset.forceGraph = '1';
        document.head.appendChild(script);
      }
    });
    return libraryPromise;
  }

  function colours() {
    var style = getComputedStyle(document.documentElement);
    return {
      page: style.getPropertyValue('--page-bg').trim(),
      text: style.getPropertyValue('--page-fg').trim(),
      surface: style.getPropertyValue('--surface').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      rule: style.getPropertyValue('--rule').trim(),
      dim: style.getPropertyValue('--dim').trim()
    };
  }

  var FAMILY_HUES = [210, 18, 145, 278, 42, 330, 184, 96, 255, 5, 165, 60];

  function familyColour(hue, kind) {
    if (kind === 'board') return 'hsl(' + hue + ', 72%, 49%)';
    if (kind === 'thread') return 'hsl(' + hue + ', 68%, 58%)';
    return 'hsla(' + hue + ', 58%, 64%, .82)';
  }

  function nodeRadius(node) {
    if (node.kind === 'board') return 33;
    if (node.kind === 'thread') return 10;
    return 6;
  }

  var WELL_ZERO = Math.sqrt(.5);

  function buildMassCell(bodies, x0, y0, size, depth) {
    var mass = 0;
    var weightedX = 0;
    var weightedY = 0;
    var weightedRadius = 0;
    var maximumRadius = 0;
    bodies.forEach(function (body) {
      mass += body.mass;
      weightedX += body.x * body.mass;
      weightedY += body.y * body.mass;
      weightedRadius += nodeRadius(body) * body.mass;
      maximumRadius = Math.max(maximumRadius, nodeRadius(body));
    });
    var cell = {
      x0: x0,
      y0: y0,
      size: size,
      mass: mass,
      x: weightedX / mass,
      y: weightedY / mass,
      radius: weightedRadius / mass,
      maximumRadius: maximumRadius,
      bodies: null,
      children: null
    };
    if (bodies.length <= 6 || depth >= 16) {
      cell.bodies = bodies;
      return cell;
    }

    var half = size / 2;
    var middleX = x0 + half;
    var middleY = y0 + half;
    var groups = [[], [], [], []];
    bodies.forEach(function (body) {
      var quadrant = (body.x >= middleX ? 1 : 0) + (body.y >= middleY ? 2 : 0);
      groups[quadrant].push(body);
    });
    cell.children = groups.map(function (group, quadrant) {
      if (group.length === 0) return null;
      return buildMassCell(
        group,
        x0 + (quadrant % 2) * half,
        y0 + (quadrant > 1 ? half : 0),
        half,
        depth + 1
      );
    });
    return cell;
  }

  function buildMassTree(nodes) {
    if (nodes.length === 0) return null;
    var minimumX = Infinity;
    var minimumY = Infinity;
    var maximumX = -Infinity;
    var maximumY = -Infinity;
    nodes.forEach(function (node) {
      minimumX = Math.min(minimumX, node.x);
      minimumY = Math.min(minimumY, node.y);
      maximumX = Math.max(maximumX, node.x);
      maximumY = Math.max(maximumY, node.y);
    });
    var size = Math.max(1, maximumX - minimumX, maximumY - minimumY);
    return buildMassCell(nodes, minimumX, minimumY, size, 0);
  }

  function massWellForce(strength, padding, theta, cutoff) {
    var nodes = [];
    function force(alpha) {
      var tree = buildMassTree(nodes);
      if (!tree) return;

      function interact(node, sourceX, sourceY, sourceMass, sourceRadius) {
        var dx = sourceX - node.x;
        var dy = sourceY - node.y;
        var distanceSquared = dx * dx + dy * dy;
        if (distanceSquared === 0) {
          dx = ((node.index * 17) % 11 - 5) * .01 || .01;
          dy = ((node.index * 23) % 13 - 6) * .01 || .01;
          distanceSquared = dx * dx + dy * dy;
        }
        var distance = Math.sqrt(distanceSquared);
        var equilibrium = nodeRadius(node) + sourceRadius + padding;
        var scaledDistance = distance * WELL_ZERO / equilibrium;
        if (scaledDistance > cutoff) return;
        var squaredDistance = scaledDistance * scaledDistance;
        var radialForce = (squaredDistance - .5) * Math.exp(-squaredDistance);
        var acceleration = strength * sourceMass * radialForce * alpha;
        node.vx += dx / distance * acceleration;
        node.vy += dy / distance * acceleration;
      }

      function visit(node, cell) {
        var nearestX = Math.max(cell.x0, Math.min(node.x, cell.x0 + cell.size));
        var nearestY = Math.max(cell.y0, Math.min(node.y, cell.y0 + cell.size));
        var nearestDistance = Math.hypot(node.x - nearestX, node.y - nearestY);
        var maximumRange = (nodeRadius(node) + cell.maximumRadius + padding) / WELL_ZERO * cutoff;
        if (nearestDistance > maximumRange) return;

        if (cell.bodies) {
          cell.bodies.forEach(function (other) {
            if (other !== node) interact(node, other.x, other.y, other.mass, nodeRadius(other));
          });
          return;
        }

        var dx = cell.x - node.x;
        var dy = cell.y - node.y;
        var distance = Math.hypot(dx, dy);
        var containsNode = node.x >= cell.x0 && node.x <= cell.x0 + cell.size &&
          node.y >= cell.y0 && node.y <= cell.y0 + cell.size;
        if (!containsNode && distance > 0 && cell.size / distance < theta) {
          interact(node, cell.x, cell.y, cell.mass, cell.radius);
          return;
        }
        cell.children.forEach(function (child) {
          if (child) visit(node, child);
        });
      }

      nodes.forEach(function (node) { visit(node, tree); });
    }
    force.initialize = function (nextNodes) {
      nodes = nextNodes || [];
      nodes.forEach(function (node, index) { node.index = index; });
    };
    return force;
  }

  function graphData(payload) {
    var nodes = [];
    var boardFamilies = {};
    var threadSizes = {};

    payload.posts.forEach(function (post) {
      threadSizes[post.thread_id] = (threadSizes[post.thread_id] || 0) + 1;
    });

    payload.boards.forEach(function (board, index) {
      var hue = FAMILY_HUES[index % FAMILY_HUES.length];
      boardFamilies[board.name] = { hue: hue };
      nodes.push({
        id: 'board:' + board.id,
        kind: 'board',
        board: board.name,
        description: board.description,
        postCount: board.post_count,
        mass: 3 + Math.log1p(board.post_count) * .55,
        familyHue: hue,
        url: '/boards/' + encodeURIComponent(board.name)
      });
    });

    payload.posts.forEach(function (post) {
      if (post.kind !== 'thread') return;
      var family = boardFamilies[post.board] || { hue: 210 };
      nodes.push({
        id: 'post:' + post.id,
        postId: post.id,
        threadId: post.thread_id,
        kind: post.kind,
        board: post.board,
        mass: 1.5 + Math.log1p(threadSizes[post.thread_id] || 1) * .4,
        familyHue: family.hue,
        url: '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id
      });
    });

    payload.posts.forEach(function (post) {
      if (post.kind === 'thread') return;
      var family = boardFamilies[post.board] || { hue: 210 };
      nodes.push({
        id: 'post:' + post.id,
        postId: post.id,
        threadId: post.thread_id,
        kind: post.kind,
        board: post.board,
        mass: 1,
        familyHue: family.hue,
        url: '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id
      });
    });

    var nodesById = {};
    nodes.forEach(function (node) { nodesById[node.id] = node; });
    return {
      nodes: nodes,
      links: payload.edges.map(function (edge, index) {
        var sourceNode = nodesById[edge.source];
        return {
          id: 'edge:' + index,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
          familyHue: sourceNode ? sourceNode.familyHue : 210
        };
      })
    };
  }

  function statusText(payload) {
    if (payload.total_posts === 0) return 'No posts yet.';
    var shown = payload.posts.length + ' of ' + payload.total_posts + ' posts';
    if (payload.truncated) shown += ' · ' + payload.omitted_posts + ' outside this bounded view';
    return shown + ' · physics live';
  }

  function destroyGraph() {
    if (resizeObserver) resizeObserver.disconnect();
    if (themeObserver) themeObserver.disconnect();
    resizeObserver = null;
    themeObserver = null;
    if (graph && graph._destructor) graph._destructor();
    graph = null;
    graphContainer = null;
  }

  function randomisePositions(data) {
    var spread = Math.max(190, Math.min(420, Math.sqrt(data.nodes.length) * 12));
    data.nodes.forEach(function (node) {
      var angle = Math.random() * Math.PI * 2;
      var radius = Math.sqrt(Math.random()) * spread;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
      node.fx = undefined;
      node.fy = undefined;
    });
  }

  function render(container, payload, ForceGraph) {
    if (!document.documentElement.contains(container)) return;
    destroyGraph();
    graphContainer = container;
    var shell = container.closest('.board-graph-shell');
    var status = shell.querySelector('[data-graph-status]');
    var center = shell.querySelector('[data-graph-center]');
    var reset = shell.querySelector('[data-graph-reset]');
    var palette = colours();
    var data = graphData(payload);
    randomisePositions(data);

    function nodeColour(node) {
      return familyColour(node.familyHue, node.kind);
    }
    function linkColour(link) {
      var alpha = link.kind === 'reference' ? .32 : .58;
      return 'hsla(' + link.familyHue + ', 60%, 54%, ' + alpha + ')';
    }
    function sizeGraph() {
      if (!graph || graphContainer !== container) return;
      graph.width(container.clientWidth).height(container.clientHeight);
    }
    function centerGraph() {
      if (!graph || data.nodes.length === 0) return;
      var centroid = data.nodes.reduce(function (sum, node) {
        sum.x += node.x;
        sum.y += node.y;
        return sum;
      }, { x: 0, y: 0 });
      graph.centerAt(centroid.x / data.nodes.length, centroid.y / data.nodes.length, 350);
    }

    graph = ForceGraph()(container)
      .width(container.clientWidth)
      .height(container.clientHeight)
      .backgroundColor(palette.page)
      .graphData(data)
      .nodeRelSize(3.8)
      .nodeVal(function (node) {
        if (node.kind === 'board') return 72;
        if (node.kind === 'thread') return 6;
        return 1.8;
      })
      .nodeColor(nodeColour)
      .nodeCanvasObjectMode(function (node) { return node.kind === 'board' ? 'after' : undefined; })
      .nodeCanvasObject(function (node, context, globalScale) {
        if (node.kind !== 'board') return;
        var fontSize = 11 / globalScale;
        context.font = '700 ' + fontSize + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = palette.page;
        context.fillText('/' + node.board + '/', node.x, node.y);
      })
      .nodeLabel(function (node) {
        if (node.kind === 'board') {
          return '/' + node.board + '/ · ' + node.postCount + ' posts<br>' + node.description;
        }
        return 'No.' + node.postId + ' · ' + node.kind + ' · /' + node.board + '/';
      })
      .linkColor(linkColour)
      .linkWidth(function (link) {
        if (link.kind === 'contains') return 1.4;
        if (link.kind === 'reference') return .8;
        return .55;
      })
      .linkLineDash(function (link) { return link.kind === 'reference' ? [3, 4] : null; })
      .onNodeClick(function (node) { location.assign(node.url); })
      .onNodeDragEnd(function () { graph.d3ReheatSimulation(); })
      .cooldownTicks(Infinity)
      .cooldownTime(Infinity)
      .d3AlphaDecay(.01)
      .d3VelocityDecay(.35);

    graph.d3Force('charge', null);
    var linkForce = graph.d3Force('link');
    if (linkForce && linkForce.distance) {
      linkForce
        .distance(function (link) {
          if (link.kind === 'contains') return 90;
          if (link.kind === 'reference') return 140;
          return 32;
        })
        .strength(function (link) {
          if (link.kind === 'contains') return .18;
          if (link.kind === 'reference') return .025;
          return .32;
        });
    }
    graph.d3Force('mass-well', massWellForce(.8, 24, .72, 3));
    graph.d3Force('center', null);
    graph.d3ReheatSimulation();
    status.textContent = statusText(payload);

    center.addEventListener('click', centerGraph);
    reset.addEventListener('click', function () {
      randomisePositions(data);
      graph.graphData(data);
      graph.d3ReheatSimulation();
    });

    resizeObserver = new ResizeObserver(sizeGraph);
    resizeObserver.observe(container);
    themeObserver = new MutationObserver(function () {
      palette = colours();
      graph
        .backgroundColor(palette.page)
        .nodeColor(nodeColour)
        .linkColor(linkColour);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    setTimeout(function () {
      if (graph && graphContainer === container) graph.zoomToFit(450, 45);
    }, 700);
  }

  function initialise() {
    var container = document.querySelector('[data-board-graph]');
    if (!container) {
      destroyGraph();
      return;
    }
    if (container === graphContainer || container.dataset.loading === '1') return;
    container.dataset.loading = '1';
    var shell = container.closest('.board-graph-shell');
    var status = shell.querySelector('[data-graph-status]');
    Promise.all([
      loadLibrary(),
      fetch('/graph.json?limit=1000&reference_depth=2', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function (response) {
        if (!response.ok) throw new Error('Graph request failed');
        return response.json();
      })
    ]).then(function (values) {
      render(container, values[1], values[0]);
    }).catch(function () {
      if (document.documentElement.contains(container)) {
        status.textContent = 'The graph could not be loaded.';
        container.classList.add('graph-error');
      }
    }).finally(function () {
      delete container.dataset.loading;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
  window.addEventListener('swarmbook:navigated', initialise);
})();
`;
