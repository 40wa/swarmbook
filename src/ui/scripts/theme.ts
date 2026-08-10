export const THEMES = [
  { id: "system", label: "System", hint: "Follows OS light/dark" },
  { id: "light", label: "Light", hint: "Bright, blue accent" },
  { id: "dark", label: "Dark", hint: "Muted dark, blue accent" },
  { id: "yotsuba", label: "Yotsuba", hint: "Cream + red 4chan-style" },
  { id: "terminal", label: "Terminal", hint: "Black + phosphor green" },
  { id: "amber", label: "Amber CRT", hint: "Amber-on-black monochrome" },
  { id: "solar", label: "Solarized", hint: "Cool light on warm dark" },
] as const;

const themeIds = THEMES.map((theme) => theme.id);

export const themeBootScript = `
(function () {
  var key = 'swarmbook_theme_v1';
  var allowed = ${JSON.stringify(themeIds)};
  try {
    var selected = localStorage.getItem(key);
    if (!selected) {
      var legacy = document.cookie.match(/(?:^|; )swarmbook_theme=([^;]+)/);
      if (legacy) selected = decodeURIComponent(legacy[1]);
    }
    if (allowed.indexOf(selected) === -1) selected = 'system';
    if (selected === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', selected);
  } catch (err) {
    document.documentElement.removeAttribute('data-theme');
  }
})();
`;

export const themeScript = `
(function () {
  var key = 'swarmbook_theme_v1';
  var allowed = ${JSON.stringify(themeIds)};
  var modal = document.querySelector('.theme-modal');
  var opener = document.querySelector('[data-open-theme]');
  var menu = document.querySelector('.user-menu');
  if (!modal || !opener) return;
  var options = Array.prototype.slice.call(modal.querySelectorAll('[data-theme-id]'));

  function currentTheme() {
    var selected = null;
    try { selected = localStorage.getItem(key); } catch (err) {}
    if (allowed.indexOf(selected) === -1) {
      selected = document.documentElement.getAttribute('data-theme') || 'system';
    }
    return allowed.indexOf(selected) === -1 ? 'system' : selected;
  }

  function updateSelection(selected) {
    options.forEach(function (option) {
      var active = option.getAttribute('data-theme-id') === selected;
      option.classList.toggle('active', active);
      option.setAttribute('aria-checked', active ? 'true' : 'false');
      option.setAttribute('tabindex', active ? '0' : '-1');
    });
  }

  function applyTheme(selected) {
    if (allowed.indexOf(selected) === -1) return;
    if (selected === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', selected);
    try { localStorage.setItem(key, selected); } catch (err) {}
    updateSelection(selected);
  }

  function focusActive() {
    var active = modal.querySelector('.theme-option.active') || options[0];
    if (active) active.focus({ preventScroll: true });
  }

  function open() {
    updateSelection(currentTheme());
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    if (menu) menu.open = false;
    focusActive();
  }

  function close() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    opener.focus({ preventScroll: true });
  }

  options.forEach(function (option) {
    option.addEventListener('click', function () {
      applyTheme(option.getAttribute('data-theme-id'));
    });
  });
  opener.addEventListener('click', open);
  modal.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('[data-close-theme]')) close();
  });
  document.addEventListener('keydown', function (event) {
    if (modal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' &&
        event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    var index = options.indexOf(document.activeElement);
    var forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    index = index === -1 ? 0 : (index + (forward ? 1 : -1) + options.length) % options.length;
    event.preventDefault();
    options[index].focus({ preventScroll: true });
  });
  updateSelection(currentTheme());
})();
`;
