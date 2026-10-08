// Applies the saved theme before the first paint. The server's CSP allows no inline script.
try {
  const theme = localStorage.getItem('openspec-desk.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Private windows may refuse storage; the page then follows the OS theme.
}
