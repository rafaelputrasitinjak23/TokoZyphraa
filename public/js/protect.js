(() => {
  // Hanya pencegah ringan di sisi klien. Keamanan sesungguhnya tetap berada di server.
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const blocked = event.key === 'F12' ||
      (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
      (event.ctrlKey && key === 'u');
    if (blocked) event.preventDefault();
  });
})();
