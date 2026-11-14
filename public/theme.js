'use strict';
(() => {
  let saved;
  try { saved = localStorage.getItem('fieldwork-theme'); } catch {}
  const initial = saved === 'light' || saved === 'dark' ? saved : 'dark';
  document.documentElement.dataset.theme = initial;
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('fieldwork-theme', theme); } catch {}
    const button = document.getElementById('theme-switch');
    if (button) {
      button.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
      button.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    document.dispatchEvent(new CustomEvent('fieldwork:theme', {detail: theme}));
  }
  document.addEventListener('DOMContentLoaded', () => {
    apply(initial);
    document.getElementById('theme-switch').addEventListener('click', () => apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  });
})();
