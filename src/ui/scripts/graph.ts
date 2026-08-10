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

  function seeded(id, salt) {
    var value = Math.imul(id + salt, 2654435761) >>> 0;
    return value / 4294967295;
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

  function shortRangeRepulsion(strength, padding) {
    var nodes = [];
    function force(alpha) {
      var cellSize = 90;
      var buckets = {};
      nodes.forEach(function (node, index) {
        var cellX = Math.floor(node.x / cellSize);
        var cellY = Math.floor(node.y / cellSize);
        var key = cellX + ':' + cellY;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(index);
      });

      nodes.forEach(function (node, index) {
        var cellX = Math.floor(node.x / cellSize);
        var cellY = Math.floor(node.y / cellSize);
        for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
            var neighbours = buckets[(cellX + offsetX) + ':' + (cellY + offsetY)] || [];
            neighbours.forEach(function (otherIndex) {
              if (otherIndex <= index) return;
              var other = nodes[otherIndex];
              var dx = other.x - node.x;
              var dy = other.y - node.y;
              var distanceSquared = dx * dx + dy * dy;
              if (distanceSquared === 0) {
                dx = ((index * 17 + otherIndex * 13) % 11 - 5) * .01 || .01;
                dy = ((index * 23 + otherIndex * 19) % 13 - 6) * .01 || .01;
                distanceSquared = dx * dx + dy * dy;
              }
              var minimumDistance = nodeRadius(node) + nodeRadius(other) + padding;
              if (distanceSquared >= minimumDistance * minimumDistance) return;
              var distance = Math.sqrt(distanceSquared);
              var impulse = (minimumDistance - distance) / minimumDistance * strength * alpha;
              var forceX = dx / distance * impulse;
              var forceY = dy / distance * impulse;
              node.vx -= forceX;
              node.vy -= forceY;
              other.vx += forceX;
              other.vy += forceY;
            });
          }
        }
      });
    }
    force.initialize = function (nextNodes) { nodes = nextNodes || []; };
    return force;
  }

  function graphData(payload) {
    var nodes = [];
    var boardFamilies = {};
    var boardCount = Math.max(1, payload.boards.length);
    var ringRadius = Math.max(180, boardCount * 58);

    payload.boards.forEach(function (board, index) {
      var angle = (Math.PI * 2 * index / boardCount) - Math.PI / 2;
      var position = {
        x: Math.cos(angle) * ringRadius,
        y: Math.sin(angle) * ringRadius
      };
      var hue = FAMILY_HUES[index % FAMILY_HUES.length];
      boardFamilies[board.name] = { position: position, hue: hue };
      nodes.push({
        id: 'board:' + board.id,
        kind: 'board',
        board: board.name,
        description: board.description,
        postCount: board.post_count,
        familyHue: hue,
        x: position.x,
        y: position.y,
        url: '/boards/' + encodeURIComponent(board.name)
      });
    });

    var threadPositions = {};
    payload.posts.forEach(function (post) {
      if (post.kind !== 'thread') return;
      var family = boardFamilies[post.board] || { position: { x: 0, y: 0 }, hue: 210 };
      var center = family.position;
      var angle = seeded(post.id, 11) * Math.PI * 2;
      var radius = 55 + seeded(post.id, 29) * 95;
      var position = {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      };
      threadPositions[post.thread_id] = position;
      nodes.push({
        id: 'post:' + post.id,
        postId: post.id,
        threadId: post.thread_id,
        kind: post.kind,
        board: post.board,
        familyHue: family.hue,
        x: position.x,
        y: position.y,
        url: '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id
      });
    });

    payload.posts.forEach(function (post) {
      if (post.kind === 'thread') return;
      var family = boardFamilies[post.board] || { position: { x: 0, y: 0 }, hue: 210 };
      var center = threadPositions[post.thread_id] || family.position;
      var angle = seeded(post.id, 47) * Math.PI * 2;
      var radius = 18 + seeded(post.id, 71) * 38;
      nodes.push({
        id: 'post:' + post.id,
        postId: post.id,
        threadId: post.thread_id,
        kind: post.kind,
        board: post.board,
        familyHue: family.hue,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
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
    var spread = Math.max(260, Math.sqrt(data.nodes.length) * 28);
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
    var reset = shell.querySelector('[data-graph-reset]');
    var palette = colours();
    var data = graphData(payload);
    var cameraTick = 0;

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
    function followCentroid() {
      cameraTick += 1;
      if (!graph || cameraTick % 4 !== 0 || data.nodes.length === 0) return;
      var centroid = data.nodes.reduce(function (sum, node) {
        sum.x += node.x;
        sum.y += node.y;
        return sum;
      }, { x: 0, y: 0 });
      graph.centerAt(centroid.x / data.nodes.length, centroid.y / data.nodes.length, 0);
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
      .onEngineTick(followCentroid)
      .cooldownTicks(Infinity)
      .cooldownTime(Infinity)
      .d3AlphaDecay(.018)
      .d3VelocityDecay(.48);

    var charge = graph.d3Force('charge');
    if (charge && charge.strength) {
      charge.strength(1.8).distanceMin(72).distanceMax(320);
    }
    var linkForce = graph.d3Force('link');
    if (linkForce && linkForce.distance) {
      linkForce
        .distance(function (link) {
          if (link.kind === 'contains') return 70;
          if (link.kind === 'reference') return 125;
          return 23;
        })
        .strength(function (link) {
          if (link.kind === 'contains') return .9;
          if (link.kind === 'reference') return .04;
          return .82;
        });
    }
    graph.d3Force('near-repulsion', shortRangeRepulsion(2.6, 18));
    graph.d3Force('center', null);
    graph.d3ReheatSimulation();
    status.textContent = statusText(payload);

    reset.addEventListener('click', function () {
      randomisePositions(data);
      graph.graphData(data);
      graph.d3ReheatSimulation();
      setTimeout(function () {
        if (graph && graphContainer === container) graph.zoomToFit(450, 45);
      }, 650);
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
