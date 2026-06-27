(() => {
  const root = document.documentElement;
  const intro = document.querySelector('[data-site-intro]');

  if (!root.classList.contains('site-intro-enabled') || !intro) return;

  const video = intro.querySelector('[data-site-intro-video]');
  const skipButton = intro.querySelector('[data-site-intro-skip]');
  const storageKey = 'tokorafael:intro-shown';
  let isClosing = false;
  let fallbackTimer;

  try {
    window.sessionStorage.setItem(storageKey, '1');
  } catch (_) {
    // The intro still works when sessionStorage is unavailable.
  }

  document.body.classList.add('site-intro-open');
  intro.setAttribute('aria-hidden', 'false');

  const handleKeydown = (event) => {
    if (event.key === 'Escape') closeIntro();
  };

  const closeIntro = () => {
    if (isClosing) return;
    isClosing = true;
    window.clearTimeout(fallbackTimer);
    document.removeEventListener('keydown', handleKeydown);

    intro.classList.add('is-leaving');
    document.body.classList.remove('site-intro-open');

    window.setTimeout(() => {
      root.classList.remove('site-intro-enabled');
      root.classList.add('site-intro-disabled');
      intro.remove();
    }, 520);
  };

  skipButton?.addEventListener('click', closeIntro);
  video?.addEventListener('ended', closeIntro, { once: true });
  video?.addEventListener('error', closeIntro, { once: true });
  video?.addEventListener('playing', () => intro.classList.add('is-playing'), { once: true });

  document.addEventListener('keydown', handleKeydown);

  if (video) {
    video.muted = true;
    if (!video.paused) intro.classList.add('is-playing');
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(() => {
        intro.classList.add('playback-blocked');
        window.setTimeout(closeIntro, 1600);
      });
    }
  }

  fallbackTimer = window.setTimeout(closeIntro, 12000);
})();
