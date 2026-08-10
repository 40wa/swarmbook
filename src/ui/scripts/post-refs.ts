export const postRefScript = `
(function () {
  var preview = null;
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
  });
  syncTargetHighlight();
  function findLocalPost(id) {
    return document.getElementById('post-' + id);
  }
  function showPreview(anchor, targetId) {
    removePreview();
    var target = findLocalPost(targetId);
    var div = document.createElement('div');
    div.className = 'ref-preview';
    if (target) {
      var clone = target.cloneNode(true);
      clone.removeAttribute('id');
      clone.classList.remove('is-target');
      clone.style.border = '0';
      clone.style.padding = '0';
      clone.style.background = 'transparent';
      clone.style.outline = 'none';
      div.appendChild(clone);
    } else {
      div.classList.add('missing');
      div.textContent = 'Post >>' + targetId + ' is not on this page. Click to open.';
    }
    document.body.appendChild(div);
    var rect = anchor.getBoundingClientRect();
    var top = window.scrollY + rect.bottom + 4;
    var left = Math.min(
      window.scrollX + rect.left,
      window.scrollX + document.documentElement.clientWidth - div.offsetWidth - 12
    );
    div.style.top = top + 'px';
    div.style.left = Math.max(8, left) + 'px';
    preview = div;
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
})();
`;
