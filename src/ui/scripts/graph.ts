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

  function identityHue(identity) {
    var hash = 2166136261;
    for (var index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 360;
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

  // Gource-style layout: board-family anchors, surface-to-surface hierarchy
  // springs, outward branch continuation and overlap-only packing.
  function gourceHierarchyForce(links) {
    var nodes = [];
    var topology = structuralTopology(nodes, links);
    var nodeStates = [];

    function force(alpha) {
      if (nodes.length === 0) return;
      var index;

      for (index = 0; index < nodeStates.length; index += 1) {
        var state = nodeStates[index];
        var node = state.node;
        if (!state.parent && node.kind !== 'board') continue;
        var anchorX = state.parent ? state.parent.x :
          typeof node.clusterX === 'number' ? node.clusterX : 0;
        var anchorY = state.parent ? state.parent.y :
          typeof node.clusterY === 'number' ? node.clusterY : 0;
        var dx = anchorX - node.x;
        var dy = anchorY - node.y;
        var distanceSquared = dx * dx + dy * dy;
        var distance = Math.sqrt(distanceSquared);
        if (node.kind === 'board' && distance < .001) continue;
        if (distance < .001) {
          dx = ((node.index * 17) % 11 - 5) * .01 || .01;
          dy = ((node.index * 23) % 13 - 6) * .01 || .01;
          distance = Math.sqrt(dx * dx + dy * dy);
        }
        var anchorRadius = state.parent ? state.parentRadius : 0;
        var gap = node.kind === 'board' ? 0 : state.relation === 'contains' ? 18 : 10;
        var restDistance = anchorRadius + state.radius + gap;
        var springStrength = node.kind === 'board' ? .09 : state.relation === 'contains' ? .075 : .13;
        var spring = (distance - restDistance) * springStrength * alpha;
        node.vx += dx / distance * spring;
        node.vy += dy / distance * spring;

        if (!state.parent) continue;
        var grandX = state.grandparent ? state.grandparent.x :
          typeof state.parent.clusterX === 'number' ? state.parent.clusterX : 0;
        var grandY = state.grandparent ? state.grandparent.y :
          typeof state.parent.clusterY === 'number' ? state.parent.clusterY : 0;
        var branchX = state.parent.x - grandX;
        var branchY = state.parent.y - grandY;
        var branchLength = Math.sqrt(branchX * branchX + branchY * branchY);
        if (branchLength < .001) continue;
        var targetX = state.parent.x + branchX / branchLength * restDistance;
        var targetY = state.parent.y + branchY / branchLength * restDistance;
        var continuation = state.relation === 'reply' ? .038 : .022;
        node.vx += (targetX - node.x) * continuation * alpha;
        node.vy += (targetY - node.y) * continuation * alpha;
      }

      // Pack structural board/thread nodes only. Replies behave like Gource file
      // leaves: their hierarchy springs place them without a global collision body.
      // Cached radii and squared-distance rejection keep the spatial hash cheap.
      var cellSize = 96;
      var cells = Object.create(null);
      for (index = 0; index < nodeStates.length; index += 1) {
        var cellState = nodeStates[index];
        if (!cellState.collides) continue;
        var cellNode = cellState.node;
        var cellX = Math.floor(cellNode.x / cellSize);
        var cellY = Math.floor(cellNode.y / cellSize);
        var key = cellX + ':' + cellY;
        (cells[key] || (cells[key] = [])).push(cellState);
      }
      for (index = 0; index < nodeStates.length; index += 1) {
        var nodeState = nodeStates[index];
        if (!nodeState.collides) continue;
        var packedNode = nodeState.node;
        var packedCellX = Math.floor(packedNode.x / cellSize);
        var packedCellY = Math.floor(packedNode.y / cellSize);
        for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
            var nearby = cells[(packedCellX + offsetX) + ':' + (packedCellY + offsetY)] || [];
            for (var nearbyIndex = 0; nearbyIndex < nearby.length; nearbyIndex += 1) {
              var otherState = nearby[nearbyIndex];
              var other = otherState.node;
              if (other.index <= packedNode.index) continue;
              var pairX = other.x - packedNode.x;
              var pairY = other.y - packedNode.y;
              var minimumDistance = nodeState.radius + otherState.radius + 5;
              var pairDistanceSquared = pairX * pairX + pairY * pairY;
              if (pairDistanceSquared >= minimumDistance * minimumDistance) continue;
              if (pairDistanceSquared < .000001) {
                pairX = ((packedNode.index + other.index * 7) % 9 - 4) * .01 || .01;
                pairY = ((packedNode.index * 5 + other.index) % 11 - 5) * .01 || .01;
                pairDistanceSquared = pairX * pairX + pairY * pairY;
              }
              var pairDistance = Math.sqrt(pairDistanceSquared);
              var overlap = (minimumDistance - pairDistance) * .62 * alpha;
              var totalInertia = nodeState.inertia + otherState.inertia;
              var nodeShare = otherState.inertia / totalInertia;
              var otherShare = nodeState.inertia / totalInertia;
              packedNode.vx -= pairX / pairDistance * overlap * nodeShare;
              packedNode.vy -= pairY / pairDistance * overlap * nodeShare;
              other.vx += pairX / pairDistance * overlap * otherShare;
              other.vy += pairY / pairDistance * overlap * otherShare;
            }
          }
        }
      }
    }

    force.initialize = function (nextNodes) {
      nodes = nextNodes || [];
      nodes.forEach(function (node, index) { node.index = index; });
      topology = structuralTopology(nodes, links);
      nodeStates = nodes.map(function (node) {
        var parent = topology.parentById[node.id];
        return {
          node: node,
          parent: parent,
          grandparent: parent && topology.parentById[parent.id],
          relation: topology.relationById[node.id],
          radius: collisionRadius(node),
          parentRadius: parent ? collisionRadius(parent) : 0,
          inertia: inertia(node),
          collides: node.kind === 'board' || node.kind === 'thread'
        };
      });
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
        owner: post.owner,
        author: post.author,
        authorHue: identityHue(post.author),
        ownerHue: identityHue(post.owner),
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
        owner: post.owner,
        author: post.author,
        authorHue: identityHue(post.author),
        ownerHue: identityHue(post.owner),
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
        var targetNode = nodesById[edge.target];
        var authorNode = edge.kind === 'reference' ? sourceNode : targetNode;
        return {
          id: 'edge:' + index,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
          familyHue: sourceNode ? sourceNode.familyHue : 210,
          authorHue: authorNode && authorNode.authorHue,
          ownerHue: authorNode && authorNode.ownerHue
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

  function shuffled(values) {
    var result = values.slice();
    for (var index = result.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(Math.random() * (index + 1));
      var value = result[index];
      result[index] = result[swapIndex];
      result[swapIndex] = value;
    }
    return result;
  }

  function randomiseHierarchy(data) {
    var topology = structuralTopology(data.nodes, data.links);
    var rootRadius = virtualRootRadius(data.nodes);
    var placed = {};
    var childrenByParent = {};
    var siblingIndexById = {};
    var familyArea = {};
    var boards = shuffled(data.nodes.filter(function (node) { return node.kind === 'board'; }));

    data.nodes.forEach(function (node) {
      var radius = collisionRadius(node) + 3;
      familyArea[node.board] = (familyArea[node.board] || 0) + radius * radius;
      var parent = topology.parentById[node.id];
      if (!parent) return;
      var siblings = childrenByParent[parent.id] || (childrenByParent[parent.id] = []);
      siblingIndexById[node.id] = siblings.length;
      siblings.push(node);
    });

    var boardLayouts = boards.map(function (node) {
      return {
        node: node,
        radius: Math.max(
          collisionRadius(node) + 30,
          Math.sqrt(familyArea[node.board] || 0) * 1.35 + 32
        )
      };
    });
    var circumference = boardLayouts.reduce(function (sum, layout) {
      return sum + layout.radius * 2 + 72;
    }, 0);
    var largestFamily = boardLayouts.reduce(function (largest, layout) {
      return Math.max(largest, layout.radius);
    }, 0);
    var boardRingRadius = boards.length <= 1
      ? 0
      : Math.max(rootRadius + largestFamily, circumference / (Math.PI * 2));
    var boardCursor = Math.random() * Math.PI * 2;

    boardLayouts.forEach(function (layout) {
      var arc = circumference > 0
        ? (layout.radius * 2 + 72) / circumference * Math.PI * 2
        : Math.PI * 2;
      var angle = boardCursor + arc / 2 + (Math.random() - .5) * arc * .12;
      var distance = boardRingRadius * (.96 + Math.random() * .08);
      var node = layout.node;
      node.x = Math.cos(angle) * distance;
      node.y = Math.sin(angle) * distance;
      node.clusterX = node.x;
      node.clusterY = node.y;
      placed[node.id] = true;
      boardCursor += arc;
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
          var siblings = childrenByParent[parent.id] || [node];
          var siblingIndex = siblingIndexById[node.id] || 0;
          var familyDirection = boards.length > 1
            ? Math.atan2(parent.clusterY, parent.clusterX)
            : Math.random() * Math.PI * 2;
          var familySpan = boards.length > 1
            ? Math.min(Math.PI * .9, Math.PI * 2 / boards.length * .72)
            : Math.PI * 2;
          var slot = (siblingIndex + .5) / siblings.length - .5;
          angle = familyDirection + slot * familySpan;
          angle += (Math.random() - .5) * familySpan / siblings.length * .55;
        }
        var gap = topology.relationById[node.id] === 'contains' ? 18 : 10;
        var distance = collisionRadius(parent) + collisionRadius(node) + gap;
        if (!grandparent) {
          var threadSpan = boards.length > 1
            ? Math.min(Math.PI * .9, Math.PI * 2 / boards.length * .72)
            : Math.PI * 2;
          var siblingCount = (childrenByParent[parent.id] || []).length;
          distance = Math.max(distance, siblingCount * (collisionRadius(node) * 2 + 5) / threadSpan);
        }
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
    var colorBySelect = shell.querySelector('[data-graph-color-by]');
    var center = shell.querySelector('[data-graph-center]');
    var reset = shell.querySelector('[data-graph-reset]');
    var palette = colours();
    var colorBy = colorBySelect.value;
    var data = graphData(payload);
    randomiseHierarchy(data);

    function nodeHue(node) {
      if (node.kind === 'board') return node.familyHue;
      if (colorBy === 'author') return node.authorHue;
      if (colorBy === 'owner') return node.ownerHue;
      return node.familyHue;
    }
    function nodeColour(node) {
      return familyColour(nodeHue(node), node.kind);
    }
    function linkColour(link) {
      var alpha = link.kind === 'reference' ? .52 : .58;
      var hue = link.familyHue;
      if (colorBy === 'author') hue = link.authorHue;
      if (colorBy === 'owner') hue = link.ownerHue;
      if (hue === undefined) hue = link.familyHue;
      return 'hsla(' + hue + ', 60%, 54%, ' + alpha + ')';
    }
    function drawBoardLabel(node, context, globalScale) {
      if (node.kind !== 'board') return;
      var radius = renderRadius(node);
      var fontSize = 11 / globalScale;
      context.save();
      context.font = '700 ' + fontSize + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillStyle = palette.text;
      context.shadowColor = palette.page;
      context.shadowBlur = 4 / globalScale;
      context.fillText('/' + node.board + '/', node.x + radius + 5 / globalScale, node.y);
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
      .nodeCanvasObjectMode(function (node) { return node.kind === 'board' ? 'after' : undefined; })
      .nodeCanvasObject(drawBoardLabel)
      .nodeLabel(function (node) {
        if (node.kind === 'board') {
          return '/' + node.board + '/ · ' + node.postCount + ' posts<br>' + node.description;
        }
        return 'No.' + node.postId + ' · ' + node.kind + ' · ' + node.author + ' · /' + node.board + '/';
      })
      .linkColor(linkColour)
      .linkWidth(function (link) {
        return link.kind === 'contains' ? 1.4 : link.kind === 'reference' ? .9 : .8;
      })
      .linkLineDash(function (link) { return link.kind === 'reference' ? [4, 5] : null; })
      .onNodeClick(function (node) { location.assign(node.url); })
      .onNodeDragEnd(function () { graph.d3ReheatSimulation(); })
      .autoPauseRedraw(true)
      .cooldownTicks(140)
      .cooldownTime(3500)
      .d3AlphaMin(.015)
      .d3AlphaDecay(.04)
      .d3VelocityDecay(.72);

    graph.d3Force('charge', null);
    graph.d3Force('link', null);
    graph.d3Force('gource-hierarchy', gourceHierarchyForce(data.links));
    graph.d3Force('center', null);
    graph.d3ReheatSimulation();
    centerGraph();
    status.textContent = '';

    center.addEventListener('click', centerGraph);
    colorBySelect.addEventListener('change', function () {
      colorBy = ['board', 'author', 'owner'].indexOf(colorBySelect.value) >= 0
        ? colorBySelect.value
        : 'board';
      graph
        .nodeColor(nodeColour)
        .linkColor(linkColour)
        .refresh();
    });
    reset.addEventListener('click', function () {
      randomiseHierarchy(data);
      graph.graphData(data);
      graph.d3ReheatSimulation();
      centerGraph();
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
