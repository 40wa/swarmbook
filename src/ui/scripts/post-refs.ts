export const postRefScript = `
(function () {
  var preview = null;
  var remotePosts = Object.create(null);
  function removePreview() { if (preview) { preview.remove(); preview = null; } }
  function syncTargetHighlight() {
    var current = document.querySelectorAll('article.post.is-target');
    for (var i = 0; i < current.length; i += 1) current[i].classList.remove('is-target');
    if (!location.hash) return;
    var target;
    try { target = document.querySelector(location.hash); } catch (err) { return; }
    if (target && target.matches('article.post')) target.classList.add('is-target');
  }
  window.__syncTargetHighlight = syncTargetHighlight;
  window.addEventListener('hashchange', syncTargetHighlight);
  window.addEventListener('swarmbook:navigated', function () {
    removePreview();
    syncTargetHighlight();
    markOffPageRefs();
  });
  syncTargetHighlight();
  function findLocalPost(id) {
    return document.getElementById('post-' + id);
  }
  function markOffPageRefs() {
    var anchors = document.querySelectorAll('a[data-ref]');
    for (var i = 0; i < anchors.length; i += 1) {
      var id = anchors[i].getAttribute('data-ref');
      anchors[i].classList.toggle('off-page', Boolean(id && !findLocalPost(id)));
    }
  }
  function positionPreview(anchor, div) {
    if (!document.contains(anchor) || preview !== div) return;
    var rect = anchor.getBoundingClientRect();
    var top = window.scrollY + rect.bottom + 4;
    var left = Math.min(
      window.scrollX + rect.left,
      window.scrollX + document.documentElement.clientWidth - div.offsetWidth - 12
    );
    div.style.top = top + 'px';
    div.style.left = Math.max(8, left) + 'px';
  }
  function renderPost(div, target, offPage) {
    div.classList.remove('loading', 'missing');
    div.textContent = '';
    var clone = target.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.remove('is-target');
    clone.style.border = '0';
    clone.style.padding = '0';
    clone.style.background = 'transparent';
    clone.style.outline = 'none';
    div.appendChild(clone);
    if (offPage) {
      var note = document.createElement('div');
      note.className = 'ref-preview-destination';
      note.textContent = 'Opens this post on another page ↗';
      div.appendChild(note);
    }
  }
  function loadRemotePost(anchor, targetId, div) {
    if (remotePosts[targetId]) {
      renderPost(div, remotePosts[targetId], true);
      positionPreview(anchor, div);
      return;
    }
    fetch(anchor.href, {
      headers: { 'Accept': 'text/html' },
      credentials: 'same-origin',
      redirect: 'follow'
    }).then(function (response) {
      if (!response.ok) throw new Error('post request failed');
      return response.text();
    }).then(function (html) {
      var page = new DOMParser().parseFromString(html, 'text/html');
      var target = page.getElementById('post-' + targetId);
      if (!target) throw new Error('post missing from response');
      remotePosts[targetId] = target;
      if (preview !== div) return;
      renderPost(div, target, true);
      positionPreview(anchor, div);
    }).catch(function () {
      if (preview !== div) return;
      div.classList.remove('loading');
      div.classList.add('missing');
      div.textContent = 'Preview unavailable · click to open post ↗';
      positionPreview(anchor, div);
    });
  }
  function showPreview(anchor, targetId) {
    removePreview();
    var target = findLocalPost(targetId);
    var div = document.createElement('div');
    div.className = 'ref-preview';
    if (target) {
      renderPost(div, target, false);
    } else {
      div.classList.add('loading');
      div.textContent = 'Loading post >>' + targetId + '…';
    }
    document.body.appendChild(div);
    preview = div;
    positionPreview(anchor, div);
    if (!target) loadRemotePost(anchor, targetId, div);
  }
  document.addEventListener('mouseover', function (event) {
    var anchor = event.target.closest && event.target.closest('a[data-ref]');
    if (!anchor) return;
    var id = anchor.getAttribute('data-ref');
    if (id) showPreview(anchor, id);
  });
  document.addEventListener('mouseout', function (event) {
    var anchor = event.target.closest && event.target.closest('a[data-ref]');
    if (anchor) removePreview();
  });
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest && event.target.closest('a[data-ref]');
    if (!anchor) return;
    var id = anchor.getAttribute('data-ref');
    var local = findLocalPost(id);
    if (!local) return;
    event.preventDefault();
    var hash = '#post-' + id;
    if (location.hash === hash && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    location.hash = hash;
    if (typeof window.__syncTargetHighlight === 'function') window.__syncTargetHighlight();
  });
  markOffPageRefs();
})();
`;
