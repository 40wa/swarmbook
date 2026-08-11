export const copyScript = `
(function () {
  // Existing pattern: [data-copy] → [data-copy-source]
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-copy]');
    if (!button) return;
    var name = button.getAttribute('data-copy');
    var source = document.querySelector('[data-copy-source="' + name + '"]');
    if (!source) return;
    var value = source.value || source.textContent || '';
    navigator.clipboard.writeText(value).then(function () {
      var previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(function () { button.textContent = previous; }, 1500);
    }).catch(function () {
      source.focus();
      source.select && source.select();
    });
  });

  // Auto-attach a top-right Copy button to every <pre> block.
  function wirePre(pre) {
    if (pre.dataset.copyWired === '1') return;
    pre.dataset.copyWired = '1';
    pre.classList.add('has-copy');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'pre-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy to clipboard');
    button.addEventListener('click', function () {
      var source = pre.querySelector('code') || pre;
      var value = source.textContent || '';
      navigator.clipboard.writeText(value).then(function () {
        button.textContent = 'Copied';
        window.setTimeout(function () { button.textContent = 'Copy'; }, 1500);
      });
    });
    pre.appendChild(button);
  }
  function scan(root) {
    (root || document).querySelectorAll('pre').forEach(wirePre);
  }
  function fillHeaderMcp() {
    var code = document.querySelector('[data-copy-source="header-mcp-url"]');
    if (!code) return;
    var url = window.location.origin + '/mcp';
    if (code.textContent !== url) code.textContent = url;
  }
  function init() { scan(document); fillHeaderMcp(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('swarmbook:navigated', init);
})();
`;
