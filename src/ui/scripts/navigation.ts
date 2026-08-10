export const navigationScript = `
(function () {
  var sequence = 0;

  function shellKey(doc) {
    return doc.body && doc.body.getAttribute('data-shell');
  }

  function eligibleAnchor(anchor) {
    if (!anchor || anchor.closest('[data-noswap]')) return null;
    if (anchor.target && anchor.target !== '_self') return null;
    if (anchor.hasAttribute('download')) return null;
    var url;
    try { url = new URL(anchor.href, location.href); } catch (err) { return null; }
    if (url.origin !== location.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  function navigate(href, push) {
    var request = ++sequence;
    var intended = new URL(href, location.href);
    var intendedHash = intended.hash;
    var tail = document.querySelector('.live-tail');
    var tailScroll = tail ? tail.scrollTop : 0;

    fetch(intended.href, {
      headers: { 'Accept': 'text/html' },
      credentials: 'same-origin',
      redirect: 'follow'
    }).then(function (response) {
      var contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.indexOf('text/html') === -1) throw new Error('not an HTML page');
      return response.text().then(function (html) { return { html: html, url: response.url || intended.href }; });
    }).then(function (result) {
      if (request !== sequence) return;
      var next = new DOMParser().parseFromString(result.html, 'text/html');
      var nextMain = next.querySelector('main');
      var main = document.querySelector('main');
      if (!nextMain || !main || shellKey(next) !== shellKey(document)) {
        location.assign(intended.href);
        return;
      }

      var finalUrl = new URL(result.url, location.href);
      if (intendedHash) finalUrl.hash = intendedHash;
      main.replaceWith(nextMain);
      if (next.title) document.title = next.title;
      if (push) history.pushState({ swarmbook: true }, '', finalUrl.href);
      if (tail) tail.scrollTop = tailScroll;
      document.body.classList.remove('tail-open');
      window.dispatchEvent(new CustomEvent('swarmbook:navigated', { detail: { url: finalUrl.href } }));

      if (finalUrl.hash) {
        var target = document.getElementById(decodeURIComponent(finalUrl.hash.slice(1)));
        if (target) target.scrollIntoView();
      } else {
        window.scrollTo(0, 0);
      }
    }).catch(function () {
      location.assign(intended.href);
    });
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target.closest && event.target.closest('a[href]');
    var url = eligibleAnchor(anchor);
    if (!url) return;
    event.preventDefault();
    navigate(url.href, true);
  });

  document.addEventListener('submit', function (event) {
    if (event.defaultPrevented) return;
    var form = event.target;
    if (!form || form.closest('[data-noswap]') || String(form.method).toLowerCase() !== 'get') return;
    var url = new URL(form.action || location.href, location.href);
    if (url.origin !== location.origin) return;
    url.search = new URLSearchParams(new FormData(form)).toString();
    event.preventDefault();
    navigate(url.href, true);
  });

  window.addEventListener('popstate', function () { navigate(location.href, false); });
})();
`;
