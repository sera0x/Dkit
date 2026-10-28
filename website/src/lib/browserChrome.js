
export const MARKETING_THEME_COLOR = '#050606';
export const SHELL_LIGHT_THEME_COLOR = '#ffffff';
const STRIP_ID = 'dkit-chrome-tint';

function setThemeColor(color) {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', color);
  document.head.appendChild(meta);
}

function replaceStrip(color) {
  const old = document.getElementById(STRIP_ID);
  if (old) old.remove();
  const strip = document.createElement('div');
  strip.id = STRIP_ID;
  strip.setAttribute('aria-hidden', 'true');
  strip.style.backgroundColor = color;
  document.body.appendChild(strip);
}

let resampleTimer = null;
let stripColor = MARKETING_THEME_COLOR;

export function syncChrome() {
  const root = document.documentElement;
  if (root.getAttribute('data-chrome') === 'light') {
    stripColor = SHELL_LIGHT_THEME_COLOR;
    setThemeColor(SHELL_LIGHT_THEME_COLOR);
    replaceStrip(SHELL_LIGHT_THEME_COLOR);
    resampleAfterReplace();
    return 'light';
  }
  setThemeColor(stripColor);
  replaceStrip(stripColor);
  resampleAfterReplace();
  return 'dark';
}

function resampleAfterReplace() {
  clearTimeout(resampleTimer);
  resampleTimer = setTimeout(() => replaceStrip(stripColor), 150);
}

export function applyChromeTheme(theme) {
  const color = theme === 'light' ? SHELL_LIGHT_THEME_COLOR : MARKETING_THEME_COLOR;
  stripColor = color;
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-chrome', 'light');
  else root.removeAttribute('data-chrome');
  root.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  setThemeColor(color);
  replaceStrip(color);
  resampleAfterReplace();
}

export function nudgeBrowserChrome({ keepPosition = false } = {}) {
  const t = setTimeout(() => {
    const y = keepPosition ? window.scrollY : 0;
    window.scrollTo(0, y + 1);
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, 60);
  return () => clearTimeout(t);
}
