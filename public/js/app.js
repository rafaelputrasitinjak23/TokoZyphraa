(() => {
  const navToggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');
  navToggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('[data-alert-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('.alert')?.remove());
  });

  document.querySelectorAll('[data-captcha-refresh]').forEach((button) => {
    button.addEventListener('click', () => {
      const image = button.querySelector('img');
      if (!image) return;
      const base = image.src.split('?')[0];
      image.src = `${base}?t=${Date.now()}`;
    });
  });

  const countdown = document.querySelector('[data-countdown]');
  if (countdown) {
    const target = new Date(countdown.dataset.countdown).getTime();
    const render = () => {
      const diff = Math.max(0, target - Date.now());
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1000);
      countdown.querySelector('[data-hours]').textContent = String(hours).padStart(2, '0');
      countdown.querySelector('[data-minutes]').textContent = String(minutes).padStart(2, '0');
      countdown.querySelector('[data-seconds]').textContent = String(seconds).padStart(2, '0');
    };
    render();
    setInterval(render, 1000);
  }

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        const original = button.textContent;
        button.textContent = 'Tersalin';
        setTimeout(() => { button.textContent = original; }, 1300);
      } catch (_) {
        window.prompt('Salin nilai berikut:', button.dataset.copy);
      }
    });
  });
})();
