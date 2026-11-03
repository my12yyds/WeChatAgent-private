// Apply the theme before styles and the first paint, including native controls.
(() => {
  let stored;
  try { stored = localStorage.getItem('wechatagent-console-theme'); } catch {}
  const theme = window.desktop?.initialTheme ?? (['light','dark'].includes(stored) ? stored : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
