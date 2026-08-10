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

  function graphData(payload) {
    var nodes = [];
    var boardPositions = {};
    var boardCount = Math.max(1, payload.boards.length);
    var ringRadius = Math.max(180, boardCount * 58);

    payload.boards.forEach(function (board, index) {
      var angle = (Math.PI * 2 * index / boardCount) - Math.PI / 2;
      var position = {
        x: Math.cos(angle) * ringRadius,
        y: Math.sin(angle) * ringRadius
      };
      boardPositions[board.name] = position;
      nodes.push({
        id: 'board:' + board.id,
        kind: 'board',
        board: board.name,
        description: board.description,
        postCount: board.post_count,
        x: position.x,
        y: position.y,
        url: '/boards/' + encodeURIComponent(board.name)
      });
    });

    var threadPositions = {};
    payload.posts.forEach(function (post) {
      if (post.kind !== 'thread') return;
      var center = boardPositions[post.board] || { x: 0, y: 0 };
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
        x: position.x,
        y: position.y,
        url: '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id
      });
    });

    payload.posts.forEach(function (post) {
      if (post.kind === 'thread') return;
      var center = threadPositions[post.thread_id] || boardPositions[post.board] || { x: 0, y: 0 };
      var angle = seeded(post.id, 47) * Math.PI * 2;
      var radius = 18 + seeded(post.id, 71) * 38;
      nodes.push({
        id: 'post:' + post.id,
        postId: post.id,
        threadId: post.thread_id,
        kind: post.kind,
        board: post.board,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        url: '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id
      });
    });

    return {
      nodes: nodes,
      links: payload.edges.map(function (edge, index) {
        return {
          id: 'edge:' + index,
          source: edge.source,
          target: edge.target,
          kind: edge.kind
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

  function render(container, payload, ForceGraph) {
    if (!document.documentElement.contains(container)) return;
    destroyGraph();
    graphContainer = container;
    var shell = container.closest('.board-graph-shell');
    var status = shell.querySelector('[data-graph-status]');
    var fit = shell.querySelector('[data-graph-fit]');
    var reheat = shell.querySelector('[data-graph-layout]');
    var refs = shell.querySelector('[data-graph-references]');
    var palette = colours();
    var data = graphData(payload);

    function nodeColour(node) {
      if (node.kind === 'board') return palette.accent;
      if (node.kind === 'thread') return palette.text;
      return palette.dim;
    }
    function linkColour(link) {
      if (link.kind === 'contains') return palette.accent;
      if (link.kind === 'reference') return palette.dim;
      return palette.rule;
    }
    function sizeGraph() {
      if (!graph || graphContainer !== container) return;
      graph.width(container.clientWidth).height(container.clientHeight);
    }

    graph = ForceGraph()(container)
      .width(container.clientWidth)
      .height(container.clientHeight)
      .backgroundColor(palette.page)
      .graphData(data)
      .nodeRelSize(3.4)
      .nodeVal(function (node) {
        if (node.kind === 'board') return 34;
        if (node.kind === 'thread') return 4;
        return 1;
      })
      .nodeColor(nodeColour)
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
      .linkVisibility(function (link) { return refs.checked || link.kind !== 'reference'; })
      .onNodeClick(function (node) { location.assign(node.url); })
      .onNodeDragEnd(function () { graph.d3ReheatSimulation(); })
      .cooldownTicks(Infinity)
      .cooldownTime(Infinity)
      .d3AlphaDecay(.012)
      .d3VelocityDecay(.32);

    var charge = graph.d3Force('charge');
    if (charge && charge.strength) {
      charge.strength(function (node) {
        if (node.kind === 'board') return -520;
        if (node.kind === 'thread') return -55;
        return -18;
      }).distanceMax(700);
    }
    var linkForce = graph.d3Force('link');
    if (linkForce && linkForce.distance) {
      linkForce
        .distance(function (link) {
          if (link.kind === 'contains') return 82;
          if (link.kind === 'reference') return 145;
          return 27;
        })
        .strength(function (link) {
          if (link.kind === 'contains') return .8;
          if (link.kind === 'reference') return .055;
          return .72;
        });
    }
    graph.d3ReheatSimulation();
    status.textContent = statusText(payload);

    fit.addEventListener('click', function () { graph.zoomToFit(350, 45); });
    reheat.addEventListener('click', function () { graph.d3ReheatSimulation(); });
    refs.addEventListener('change', function () {
      graph.linkVisibility(function (link) { return refs.checked || link.kind !== 'reference'; });
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
