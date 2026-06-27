(() => {
  const root = document.documentElement;
  const intro = document.querySelector('[data-site-intro]');

  if (!root.classList.contains('site-intro-enabled') || !intro) return;

  const video = intro.querySelector('[data-site-intro-video]');
  const skipButton = intro.querySelector('[data-site-intro-skip]');
  const progressBar = intro.querySelector('[data-site-intro-progress]');
  const storageKey = 'tokorafael:intro-shown';
  let isClosing = false;
  let fallbackTimer;
  let progressFrame;

  try {
    window.sessionStorage.setItem(storageKey, '1');
  } catch (_) {
    // Intro tetap berjalan saat sessionStorage tidak tersedia.
  }

  document.body.classList.add('site-intro-open');
  intro.setAttribute('aria-hidden', 'false');

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => intro.classList.add('is-ready'));
  });

  const updateProgress = () => {
    if (!video || !progressBar || isClosing) return;
    const duration = Number(video.duration || 0);
    const currentTime = Number(video.currentTime || 0);
    const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
    progressBar.style.transform = `scaleX(${progress})`;
    progressFrame = window.requestAnimationFrame(updateProgress);
  };

  const handleKeydown = (event) => {
    if (event.key === 'Escape') closeIntro();
  };

  const closeIntro = () => {
    if (isClosing) return;
    isClosing = true;
    window.clearTimeout(fallbackTimer);
    window.cancelAnimationFrame(progressFrame);
    document.removeEventListener('keydown', handleKeydown);

    if (progressBar) progressBar.style.transform = 'scaleX(1)';
    intro.classList.add('is-leaving');

    window.setTimeout(() => {
      document.body.classList.remove('site-intro-open');
      root.classList.remove('site-intro-enabled');
      root.classList.add('site-intro-disabled');
      intro.remove();
    }, 680);
  };

  skipButton?.addEventListener('click', closeIntro);
  video?.addEventListener('ended', closeIntro, { once: true });
  video?.addEventListener('error', closeIntro, { once: true });
  video?.addEventListener('playing', () => {
    intro.classList.add('is-playing');
    window.cancelAnimationFrame(progressFrame);
    progressFrame = window.requestAnimationFrame(updateProgress);
  }, { once: true });

  document.addEventListener('keydown', handleKeydown);

  if (video) {
    video.muted = true;
    if (!video.paused) {
      intro.classList.add('is-playing');
      progressFrame = window.requestAnimationFrame(updateProgress);
    }

    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(() => {
        intro.classList.add('playback-blocked');
        window.setTimeout(closeIntro, 1500);
      });
    }
  }

  fallbackTimer = window.setTimeout(closeIntro, 12000);
})();
