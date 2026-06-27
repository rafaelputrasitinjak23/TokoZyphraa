(() => {
  const root = document.documentElement;
  const storageKey = 'tokorafael:intro-shown';

  let hasBeenShown = false;
  try {
    hasBeenShown = window.sessionStorage.getItem(storageKey) === '1';
  } catch (_) {
    hasBeenShown = false;
  }

  const prefersReducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.classList.add(
    !hasBeenShown && !prefersReducedMotion
      ? 'site-intro-enabled'
      : 'site-intro-disabled'
  );
})();
