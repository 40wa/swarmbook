export const graphScript = `
(function () {
  var ASSET = '/assets/cytoscape-3.34.0.min.js';
  var libraryPromise = null;
  var graph = null;
  var graphContainer = null;

  function loadLibrary() {
    if (window.cytoscape) return Promise.resolve(window.cytoscape);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-cytoscape]');
      var script = existing || document.createElement('script');
      function loaded() {
        if (window.cytoscape) resolve(window.cytoscape);
        else reject(new Error('Cytoscape did not initialise'));
      }
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', function () {
        reject(new Error('Could not load Cytoscape'));
      }, { once: true });
      if (!existing) {
        script.src = ASSET;
        script.defer = true;
        script.dataset.cytoscape = '1';
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

  function graphStyle(palette) {
    return [
      {
        selector: 'node',
        style: {
          'background-color': palette.surface,
          'border-color': palette.rule,
          'border-width': 1,
          'color': palette.text,
          'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
          'font-size': 9,
          'label': 'data(label)',
          'text-wrap': 'wrap',
          'text-max-width': 104,
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 42,
          'height': 42,
          'overlay-opacity': 0
        }
      },
      {
        selector: 'node[kind = "board"]',
        style: {
          'background-color': palette.accent,
          'border-color': palette.accent,
          'color': palette.page,
          'font-size': 11,
          'font-weight': 700,
          'shape': 'round-rectangle',
          'width': 112,
          'height': 38
        }
      },
      {
        selector: 'node[kind = "thread"]',
        style: {
          'border-color': palette.accent,
          'border-width': 2,
          'shape': 'round-rectangle',
          'width': 118,
          'height': 54
        }
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': palette.accent,
          'border-width': 3
        }
      },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'line-color': palette.rule,
          'target-arrow-color': palette.rule,
          'target-arrow-shape': 'triangle',
          'arrow-scale': .65,
          'width': 1.2,
          'opacity': .8,
          'overlay-opacity': 0
        }
      },
      {
        selector: 'edge[kind = "contains"]',
        style: {
          'line-color': palette.accent,
          'target-arrow-color': palette.accent,
          'width': 1.8
        }
      },
      {
        selector: 'edge[kind = "reference"]',
        style: {
          'line-style': 'dashed',
          'line-color': palette.dim,
          'target-arrow-color': palette.dim,
          'width': 1.5
        }
      },
      {
        selector: '.dimmed',
        style: { 'opacity': .11 }
      }
    ];
  }

  function elements(payload) {
    var result = [];
    payload.boards.forEach(function (board, index) {
      result.push({
        group: 'nodes',
        data: {
          id: 'board:' + board.id,
          kind: 'board',
          board: board.name,
          label: '/' + board.name + '/',
          detail: board.description,
          href: '/boards/' + encodeURIComponent(board.name),
          order: index
        },
        position: { x: 150 + index * 210, y: 70 }
      });
    });
    var boardOffsets = {};
    payload.posts.forEach(function (post) {
      var offset = boardOffsets[post.board] || 0;
      boardOffsets[post.board] = offset + 1;
      var boardIndex = payload.boards.findIndex(function (board) { return board.name === post.board; });
      var label = 'No.' + post.id;
      if (post.title) label += '\\n' + post.title;
      result.push({
        group: 'nodes',
        data: {
          id: 'post:' + post.id,
          kind: post.kind,
          board: post.board,
          label: label,
          detail: post.preview,
          author: post.mininame ? post.owner + '/' + post.mininame : post.owner,
          at: post.at,
          href: '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id
        },
        position: {
          x: 150 + Math.max(0, boardIndex) * 210 + ((offset % 3) - 1) * 48,
          y: 190 + Math.floor(offset / 3) * 72
        }
      });
    });
    payload.edges.forEach(function (edge, index) {
      result.push({
        group: 'edges',
        data: {
          id: 'edge:' + index,
          source: edge.source,
          target: edge.target,
          kind: edge.kind
        }
      });
    });
    return result;
  }

  function statusText(payload) {
    if (payload.total_posts === 0) return 'No posts yet.';
    var shown = payload.posts.length + ' of ' + payload.total_posts + ' posts';
    return payload.truncated
      ? shown + ' · ' + payload.omitted_posts + ' outside this bounded view'
      : shown;
  }

  function setTooltip(tooltip, node, event) {
    tooltip.replaceChildren();
    var title = document.createElement('strong');
    title.textContent = node.data('label').replace(/\\n/g, ' · ');
    tooltip.appendChild(title);
    var meta = document.createElement('span');
    meta.className = 'graph-tooltip-meta';
    if (node.data('kind') === 'board') {
      meta.textContent = node.data('detail');
    } else {
      meta.textContent = node.data('author') + ' · /' + node.data('board') + '/';
    }
    tooltip.appendChild(meta);
    if (node.data('kind') !== 'board' && node.data('detail')) {
      var body = document.createElement('span');
      body.textContent = node.data('detail');
      tooltip.appendChild(body);
    }
    var position = event.renderedPosition || node.renderedPosition();
    tooltip.style.left = containerOffset(tooltip, 'left') + position.x + 12 + 'px';
    tooltip.style.top = containerOffset(tooltip, 'top') + position.y + 12 + 'px';
    tooltip.hidden = false;
  }

  function containerOffset(tooltip, axis) {
    var shell = tooltip.closest('.board-graph-shell');
    var container = shell.querySelector('[data-board-graph]');
    return axis === 'left'
      ? container.offsetLeft - shell.scrollLeft
      : container.offsetTop - shell.scrollTop;
  }

  function clearFocus(status, baseStatus) {
    if (!graph) return;
    graph.elements().removeClass('dimmed');
    status.textContent = baseStatus;
  }

  function focusBoard(node, status, baseStatus) {
    var board = node.data('board');
    var keepNodes = graph.nodes().filter(function (candidate) {
      return candidate.data('board') === board;
    });
    var keepEdges = graph.edges().filter(function (edge) {
      return keepNodes.contains(edge.source()) && keepNodes.contains(edge.target());
    });
    graph.elements().addClass('dimmed');
    keepNodes.removeClass('dimmed');
    keepEdges.removeClass('dimmed');
    status.textContent = '/' + board + '/ · click empty space to show every board · ' + baseStatus;
    graph.animate({ fit: { eles: keepNodes, padding: 70 }, duration: 250 });
  }

  function render(container, payload, cytoscape) {
    if (!document.documentElement.contains(container)) return;
    if (graph) graph.destroy();
    graphContainer = container;
    var shell = container.closest('.board-graph-shell');
    var status = shell.querySelector('[data-graph-status]');
    var tooltip = shell.querySelector('.graph-tooltip');
    var baseStatus = statusText(payload);
    status.textContent = baseStatus;
    var palette = colours();
    graph = cytoscape({
      container: container,
      elements: elements(payload),
      style: graphStyle(palette),
      minZoom: .2,
      maxZoom: 2.5,
      wheelSensitivity: .22,
      selectionType: 'single'
    });

    var boards = graph.nodes('[kind = "board"]');
    boards.lock();
    var layout = graph.layout({
      name: 'cose',
      animate: true,
      animationDuration: 550,
      randomize: false,
      componentSpacing: 90,
      nodeRepulsion: function (node) { return node.data('kind') === 'board' ? 900000 : 320000; },
      idealEdgeLength: function (edge) {
        if (edge.data('kind') === 'contains') return 145;
        if (edge.data('kind') === 'reference') return 190;
        return 82;
      },
      edgeElasticity: function (edge) { return edge.data('kind') === 'reference' ? 40 : 95; },
      nestingFactor: 1.1,
      gravity: .28,
      numIter: 850,
      initialTemp: 180,
      coolingFactor: .96,
      minTemp: 1
    });
    layout.one('layoutstop', function () {
      boards.unlock();
      graph.fit(undefined, 55);
    });
    layout.run();

    graph.on('mouseover', 'node', function (event) {
      container.style.cursor = 'pointer';
      setTooltip(tooltip, event.target, event);
    });
    graph.on('mouseout', 'node', function () {
      container.style.cursor = '';
      tooltip.hidden = true;
    });
    graph.on('tap', 'node[kind = "board"]', function (event) {
      focusBoard(event.target, status, baseStatus);
    });
    graph.on('tap', 'node[kind != "board"]', function (event) {
      location.assign(event.target.data('href'));
    });
    graph.on('tap', function (event) {
      if (event.target === graph) clearFocus(status, baseStatus);
    });

    var fit = shell.querySelector('[data-graph-fit]');
    var relayout = shell.querySelector('[data-graph-layout]');
    var refs = shell.querySelector('[data-graph-references]');
    fit.addEventListener('click', function () {
      clearFocus(status, baseStatus);
      graph.animate({ fit: { padding: 55 }, duration: 250 });
    });
    relayout.addEventListener('click', function () {
      clearFocus(status, baseStatus);
      graph.layout({ name: 'cose', animate: true, animationDuration: 450, randomize: true }).run();
    });
    refs.addEventListener('change', function () {
      graph.edges('[kind = "reference"]').style('display', refs.checked ? 'element' : 'none');
    });

    var observer = new MutationObserver(function () {
      if (graph && graphContainer === container) graph.style(graphStyle(colours()));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    graph.one('destroy', function () { observer.disconnect(); });
  }

  function initialise() {
    var container = document.querySelector('[data-board-graph]');
    if (!container) {
      if (graph) graph.destroy();
      graph = null;
      graphContainer = null;
      return;
    }
    if (container === graphContainer || container.dataset.loading === '1') return;
    container.dataset.loading = '1';
    var shell = container.closest('.board-graph-shell');
    var status = shell.querySelector('[data-graph-status]');
    Promise.all([
      loadLibrary(),
      fetch('/graph.json?limit=200&reference_depth=2', {
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
