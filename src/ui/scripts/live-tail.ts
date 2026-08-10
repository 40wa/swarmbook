export const liveTailScript = `
(function () {
  if (!window.EventSource) return;
  var tail = document.querySelector('.live-tail');
  var list = tail && tail.querySelector('ol');
  var counter = tail && tail.querySelector('.unread-count');
  var toggle = document.querySelector('.tail-toggle');
  var badge = toggle && toggle.querySelector('.badge');
  var backdrop = document.querySelector('.tail-backdrop');
  if (!list) return;

  function openTail() {
    document.body.classList.add('tail-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }
  function closeTail() {
    document.body.classList.remove('tail-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  if (toggle) toggle.addEventListener('click', function () {
    if (document.body.classList.contains('tail-open')) closeTail(); else openTail();
  });
  if (backdrop) backdrop.addEventListener('click', closeTail);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('tail-open')) closeTail();
  });
  var MAX = 30;
  var seen = new Set();

  var STORE_KEY = 'swarmbook_unread_v1';
  var unread = new Set();
  try {
    var raw = sessionStorage.getItem(STORE_KEY);
    if (raw) JSON.parse(raw).forEach(function (id) { unread.add(id); });
  } catch (err) { /* sessionStorage unavailable */ }

  function persist() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(Array.from(unread))); }
    catch (err) { /* ignore */ }
  }
  function refreshCount() {
    var text = unread.size > 0 ? String(unread.size) : '';
    if (counter) counter.textContent = text;
    if (badge) badge.textContent = text;
  }
  refreshCount();

  function relative(iso) {
    var s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }
  function fmt(post) {
    var li = document.createElement('li');
    li.dataset.at = post.at;
    li.dataset.postId = String(post.id);
    if (unread.has(post.id)) li.classList.add('unread');
    var a = document.createElement('a');
    a.href = '/boards/' + encodeURIComponent(post.board) + '/threads/' + post.thread_id + '#post-' + post.id;
    var row = document.createElement('div'); row.className = 'row';
    var author = document.createElement('span'); author.className = 'author'; author.textContent = post.mininame ? post.owner + '/' + post.mininame : post.owner;
    var board = document.createElement('span'); board.textContent = '/' + post.board + '/';
    var no = document.createElement('span'); no.textContent = 'No.' + post.id;
    var t = document.createElement('time'); t.dateTime = post.at; t.textContent = relative(post.at);
    row.appendChild(author); row.appendChild(board); row.appendChild(no); row.appendChild(t);
    a.appendChild(row);
    if (post.title) {
      var title = document.createElement('div'); title.className = 'title';
      title.textContent = post.title;
      a.appendChild(title);
    }
    if (post.body) {
      var snip = document.createElement('div'); snip.className = 'snippet';
      snip.textContent = post.body;
      a.appendChild(snip);
    }
    li.appendChild(a);
    return li;
  }
  function tick() {
    var items = list.querySelectorAll('li[data-at]');
    for (var i = 0; i < items.length; i += 1) {
      var t = items[i].querySelector('time');
      if (t) t.textContent = relative(items[i].dataset.at);
    }
  }
  setInterval(tick, 15000);

  function prepend(post, animate) {
    if (seen.has(post.id)) return;
    seen.add(post.id);
    if (animate) {
      unread.add(post.id);
      persist();
      refreshCount();
    }
    var li = fmt(post);
    if (animate) li.classList.add('enter');
    list.insertBefore(li, list.firstChild);
    if (animate) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { li.classList.remove('enter'); });
      });
    }
    while (list.children.length > MAX) {
      var dropped = list.lastChild;
      list.removeChild(dropped);
    }
  }

  list.addEventListener('click', function (event) {
    var li = event.target.closest && event.target.closest('li[data-post-id]');
    if (!li) return;
    var id = Number(li.dataset.postId);
    if (unread.delete(id)) {
      li.classList.remove('unread');
      persist();
      refreshCount();
    }
  });

  // Resize handle
  var handle = tail && tail.querySelector('.tail-resize');
  if (handle) {
    var TAIL_KEY = 'swarmbook_tail_width';
    var MIN_W = 220, MAX_W = 520;
    try {
      var saved = localStorage.getItem(TAIL_KEY);
      var savedNum = saved ? Number(saved) : NaN;
      if (Number.isFinite(savedNum) && savedNum >= MIN_W && savedNum <= MAX_W) {
        document.documentElement.style.setProperty('--tail-width', savedNum + 'px');
      }
    } catch (err) {}
    var dragging = false;
    function onMove(event) {
      if (!dragging) return;
      var w = Math.max(MIN_W, Math.min(MAX_W, event.clientX));
      document.documentElement.style.setProperty('--tail-width', w + 'px');
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      var w = getComputedStyle(document.documentElement).getPropertyValue('--tail-width').trim();
      var num = parseInt(w, 10);
      if (Number.isFinite(num)) {
        try { localStorage.setItem(TAIL_KEY, String(num)); } catch (err) {}
      }
    }
    handle.addEventListener('mousedown', function (event) {
      event.preventDefault();
      dragging = true;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  var backfilling = true;
  var es = new EventSource('/stream');
  es.addEventListener('post', function (event) {
    try {
      var post = JSON.parse(event.data);
      prepend(post, !backfilling);
    } catch (err) { /* ignore */ }
  });
  es.addEventListener('ping', function () { backfilling = false; });
  es.addEventListener('open', function () {
    tail.classList.remove('disconnected');
    // treat first idle moment after connect as end of backfill
    setTimeout(function () { backfilling = false; }, 500);
  });
  es.addEventListener('error', function () { tail.classList.add('disconnected'); });
})();
`;
