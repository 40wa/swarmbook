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

  function renderRadius(node) {
    if (node.kind === 'board') return 9;
    if (node.kind === 'thread') return 4.5;
    return 2.5;
  }

  function collisionRadius(node) {
    if (node.kind === 'board') {
      return 13 + Math.min(30, Math.sqrt(node.postCount || 0) * 1.1);
    }
    if (node.kind === 'thread') {
      return 7 + Math.min(14, Math.sqrt(node.threadSize || 1) * .8);
    }
    return 3.5;
  }

  function inertia(node) {
    if (node.kind === 'board') return 5;
    if (node.kind === 'thread') return 2;
    return 1;
  }

  function nodeId(value) {
    return typeof value === 'object' ? value.id : value;
  }

  function virtualRootRadius(nodes) {
    var boardArea = nodes.reduce(function (sum, node) {
      if (node.kind !== 'board') return sum;
      var radius = collisionRadius(node);
      return sum + radius * radius;
    }, 0);
    return Math.max(24, Math.min(105, Math.sqrt(boardArea) * 1.05));
  }

  function structuralTopology(nodes, links) {
    var nodesById = {};
    var parentById = {};
    var relationById = {};
    var references = [];
    nodes.forEach(function (node) { nodesById[node.id] = node; });
    links.forEach(function (link) {
      if (link.kind === 'reference') {
        references.push(link);
        return;
      }
      var parent = nodesById[nodeId(link.source)];
      var child = nodesById[nodeId(link.target)];
      if (!parent || !child) return;
      parentById[child.id] = parent;
      relationById[child.id] = link.kind;
    });
    return {
      nodesById: nodesById,
      parentById: parentById,
      relationById: relationById,
      references: references
    };
  }

  // Gource-style layout: an invisible repository root, surface-to-surface
  // hierarchy springs, outward branch continuation and overlap-only packing.
  function gourceHierarchyForce(links) {
    var nodes = [];
    var topology = structuralTopology(nodes, links);

    function force(alpha) {
      if (nodes.length === 0) return;
      var rootRadius = virtualRootRadius(nodes);
      var root = { id: 'virtual-root', x: 0, y: 0, kind: 'root' };

      nodes.forEach(function (node) {
        var parent = topology.parentById[node.id];
        if (!parent && node.kind !== 'board') return;
        var anchor = parent || root;
        var dx = anchor.x - node.x;
        var dy = anchor.y - node.y;
        var distance = Math.hypot(dx, dy);
        if (distance < .001) {
          dx = ((node.index * 17) % 11 - 5) * .01 || .01;
          dy = ((node.index * 23) % 13 - 6) * .01 || .01;
          distance = Math.hypot(dx, dy);
        }
        var anchorRadius = parent ? collisionRadius(parent) : rootRadius;
        var gap = node.kind === 'board' ? 12 : topology.relationById[node.id] === 'contains' ? 18 : 10;
        var restDistance = anchorRadius + collisionRadius(node) + gap;
        var springStrength = node.kind === 'board' ? .035 : topology.relationById[node.id] === 'contains' ? .075 : .13;
        var spring = (distance - restDistance) * springStrength * alpha;
        node.vx += dx / distance * spring;
        node.vy += dy / distance * spring;

        if (!parent) return;
        var grandparent = topology.parentById[parent.id];
        var grandX = grandparent ? grandparent.x : 0;
        var grandY = grandparent ? grandparent.y : 0;
        var branchX = parent.x - grandX;
        var branchY = parent.y - grandY;
        var branchLength = Math.hypot(branchX, branchY);
        if (branchLength < .001) return;
        var targetX = parent.x + branchX / branchLength * restDistance;
        var targetY = parent.y + branchY / branchLength * restDistance;
        var continuation = topology.relationById[node.id] === 'reply' ? .038 : .022;
        node.vx += (targetX - node.x) * continuation * alpha;
        node.vy += (targetY - node.y) * continuation * alpha;
      });

      // Pack every node against every nearby node, regardless of board family.
      // A spatial hash keeps this bounded for the thousand-node view.
      var cellSize = 96;
      var cells = {};
      nodes.forEach(function (node) {
        var cellX = Math.floor(node.x / cellSize);
        var cellY = Math.floor(node.y / cellSize);
        var key = cellX + ':' + cellY;
        (cells[key] || (cells[key] = [])).push(node);
      });
      nodes.forEach(function (node) {
        var cellX = Math.floor(node.x / cellSize);
        var cellY = Math.floor(node.y / cellSize);
        for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
            var nearby = cells[(cellX + offsetX) + ':' + (cellY + offsetY)] || [];
            nearby.forEach(function (other) {
              if (other.index <= node.index) return;
              var dx = other.x - node.x;
              var dy = other.y - node.y;
              var distance = Math.hypot(dx, dy);
              if (distance < .001) {
                dx = ((node.index + other.index * 7) % 9 - 4) * .01 || .01;
                dy = ((node.index * 5 + other.index) % 11 - 5) * .01 || .01;
                distance = Math.hypot(dx, dy);
              }
              var minimumDistance = collisionRadius(node) + collisionRadius(other) + 5;
              if (distance >= minimumDistance) return;
              var overlap = (minimumDistance - distance) * .62 * alpha;
              var totalInertia = inertia(node) + inertia(other);
              var nodeShare = inertia(other) / totalInertia;
              var otherShare = inertia(node) / totalInertia;
              node.vx -= dx / distance * overlap * nodeShare;
              node.vy -= dy / distance * overlap * nodeShare;
              other.vx += dx / distance * overlap * otherShare;
              other.vy += dy / distance * overlap * otherShare;
            });
          }
        }
      });

      // Cross references bend the branches gently without becoming structure.
      topology.references.forEach(function (link) {
        var source = topology.nodesById[nodeId(link.source)];
        var target = topology.nodesById[nodeId(link.target)];
        if (!source || !target) return;
        var dx = target.x - source.x;
        var dy = target.y - source.y;
        var distance = Math.hypot(dx, dy);
        if (distance <= 125 || distance < .001) return;
        var pull = (distance - 125) * .0025 * alpha;
        source.vx += dx / distance * pull;
        source.vy += dy / distance * pull;
        target.vx -= dx / distance * pull;
        target.vy -= dy / distance * pull;
      });
    }

    force.initialize = function (nextNodes) {
      nodes = nextNodes || [];
      nodes.forEach(function (node, index) { node.index = index; });
      topology = structuralTopology(nodes, links);
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
        threadSize: threadSizes[post.thread_id] || 1,
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

  function destroyGraph() {
    if (resizeObserver) resizeObserver.disconnect();
    if (themeObserver) themeObserver.disconnect();
    resizeObserver = null;
    themeObserver = null;
    if (graph && graph._destructor) graph._destructor();
    graph = null;
    graphContainer = null;
  }

  function randomiseHierarchy(data) {
    var topology = structuralTopology(data.nodes, data.links);
    var rootRadius = virtualRootRadius(data.nodes);
    var placed = {};

    data.nodes.filter(function (node) { return node.kind === 'board'; }).forEach(function (node) {
      var angle = Math.random() * Math.PI * 2;
      var distance = rootRadius + collisionRadius(node) + 12;
      distance *= .82 + Math.random() * .36;
      node.x = Math.cos(angle) * distance;
      node.y = Math.sin(angle) * distance;
      placed[node.id] = true;
    });

    for (var pass = 0; pass < data.nodes.length; pass += 1) {
      var progress = false;
      data.nodes.forEach(function (node) {
        if (placed[node.id]) return;
        var parent = topology.parentById[node.id];
        if (!parent || !placed[parent.id]) return;
        var grandparent = topology.parentById[parent.id];
        var angle;
        if (grandparent && placed[grandparent.id]) {
          angle = Math.atan2(parent.y - grandparent.y, parent.x - grandparent.x);
          angle += (Math.random() - .5) * (node.kind === 'reply' ? .9 : 1.3);
        } else {
          angle = Math.atan2(parent.y, parent.x) + (Math.random() - .5) * 1.7;
        }
        var gap = topology.relationById[node.id] === 'contains' ? 18 : 10;
        var distance = collisionRadius(parent) + collisionRadius(node) + gap;
        distance *= .78 + Math.random() * .35;
        node.x = parent.x + Math.cos(angle) * distance;
        node.y = parent.y + Math.sin(angle) * distance;
        placed[node.id] = true;
        progress = true;
      });
      if (!progress) break;
    }

    data.nodes.forEach(function (node) {
      if (!placed[node.id]) {
        var angle = Math.random() * Math.PI * 2;
        var distance = Math.sqrt(Math.random()) * rootRadius;
        node.x = Math.cos(angle) * distance;
        node.y = Math.sin(angle) * distance;
      }
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
    randomiseHierarchy(data);

    function nodeColour(node) {
      return familyColour(node.familyHue, node.kind);
    }
    function linkColour(link) {
      var alpha = link.kind === 'reference' ? .52 : .58;
      return 'hsla(' + link.familyHue + ', 60%, 54%, ' + alpha + ')';
    }
    function drawNode(node, context, globalScale) {
      var radius = renderRadius(node);
      var colour = nodeColour(node);
      context.save();
      context.shadowColor = colour;
      context.shadowBlur = (node.kind === 'board' ? 19 : node.kind === 'thread' ? 12 : 8) / globalScale;
      context.globalAlpha = node.kind === 'reply' ? .2 : .26;
      context.fillStyle = colour;
      context.beginPath();
      context.arc(node.x, node.y, radius * 1.8, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.shadowBlur = (node.kind === 'board' ? 10 : 6) / globalScale;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = 'hsla(' + node.familyHue + ', 85%, 82%, .88)';
      context.lineWidth = (node.kind === 'board' ? 1.6 : .8) / globalScale;
      context.stroke();
      if (node.kind === 'board') {
        var fontSize = 11 / globalScale;
        context.font = '700 ' + fontSize + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillStyle = palette.text;
        context.shadowColor = palette.page;
        context.shadowBlur = 4 / globalScale;
        context.fillText('/' + node.board + '/', node.x + radius + 5 / globalScale, node.y);
      }
      context.restore();
    }
    function paintNodePointer(node, colour, context) {
      context.fillStyle = colour;
      context.beginPath();
      context.arc(node.x, node.y, Math.max(6, renderRadius(node) + 3), 0, Math.PI * 2);
      context.fill();
    }
    function drawLink(link, context, globalScale) {
      if (typeof link.source !== 'object' || typeof link.target !== 'object') return;
      var colour = linkColour(link);
      context.save();
      context.strokeStyle = colour;
      context.globalAlpha = link.kind === 'reference' ? .78 : .86;
      context.lineWidth = (link.kind === 'contains' ? 1.4 : link.kind === 'reference' ? .9 : .8) / globalScale;
      context.shadowColor = colour;
      context.shadowBlur = (link.kind === 'reference' ? 5 : 7) / globalScale;
      if (link.kind === 'reference') context.setLineDash([4 / globalScale, 5 / globalScale]);
      context.beginPath();
      context.moveTo(link.source.x, link.source.y);
      context.lineTo(link.target.x, link.target.y);
      context.stroke();
      context.restore();
    }
    function sizeGraph() {
      if (!graph || graphContainer !== container) return;
      graph.width(container.clientWidth).height(container.clientHeight);
    }
    function centerGraph() {
      if (!graph || data.nodes.length === 0) return;
      var horizontal = data.nodes.map(function (node) { return node.x; }).sort(function (a, b) { return a - b; });
      var vertical = data.nodes.map(function (node) { return node.y; }).sort(function (a, b) { return a - b; });
      var middle = Math.floor(data.nodes.length / 2);
      var medianX = horizontal[middle];
      var medianY = vertical[middle];
      var postsByDistance = data.nodes
        .filter(function (node) { return node.kind !== 'board'; })
        .sort(function (left, right) {
          return Math.hypot(left.x - medianX, left.y - medianY) -
            Math.hypot(right.x - medianX, right.y - medianY);
        });
      var included = {};
      data.nodes.forEach(function (node) {
        if (node.kind === 'board') included[node.id] = true;
      });
      postsByDistance.slice(0, Math.ceil(postsByDistance.length * .98)).forEach(function (node) {
        included[node.id] = true;
      });
      graph.zoomToFit(400, 36, function (node) { return included[node.id]; });
    }

    graph = ForceGraph()(container)
      .width(container.clientWidth)
      .height(container.clientHeight)
      .backgroundColor(palette.page)
      .graphData(data)
      .nodeRelSize(1)
      .nodeVal(function (node) { return renderRadius(node) * renderRadius(node); })
      .nodeColor(nodeColour)
      .nodeCanvasObjectMode(function () { return 'replace'; })
      .nodeCanvasObject(drawNode)
      .nodePointerAreaPaint(paintNodePointer)
      .nodeLabel(function (node) {
        if (node.kind === 'board') {
          return '/' + node.board + '/ · ' + node.postCount + ' posts<br>' + node.description;
        }
        return 'No.' + node.postId + ' · ' + node.kind + ' · /' + node.board + '/';
      })
      .linkColor(linkColour)
      .linkCanvasObjectMode(function () { return 'replace'; })
      .linkCanvasObject(drawLink)
      .onNodeClick(function (node) { location.assign(node.url); })
      .onNodeDragEnd(function () { graph.d3ReheatSimulation(); })
      .cooldownTicks(Infinity)
      .cooldownTime(Infinity)
      .d3AlphaDecay(.008)
      .d3VelocityDecay(.78);

    graph.d3Force('charge', null);
    graph.d3Force('link', null);
    graph.d3Force('gource-hierarchy', gourceHierarchyForce(data.links));
    graph.d3Force('center', null);
    graph.d3ReheatSimulation();
    centerGraph();
    status.textContent = '';

    center.addEventListener('click', centerGraph);
    reset.addEventListener('click', function () {
      randomiseHierarchy(data);
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
