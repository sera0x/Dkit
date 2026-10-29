export function runThemeTransition(apply, event) {
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || typeof document === 'undefined' || typeof document.startViewTransition !== 'function') {
    apply();
    return;
  }

  const x = typeof event?.clientX === 'number' ? event.clientX : window.innerWidth - 32;
  const y = typeof event?.clientY === 'number' ? event.clientY : window.innerHeight - 32;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  const root = document.documentElement;
  root.style.setProperty('--theme-x', `${x}px`);
  root.style.setProperty('--theme-y', `${y}px`);
  root.style.setProperty('--theme-radius', `${radius}px`);

  document.startViewTransition(() => {
    apply();
  });
}
