import { SITE_URL } from './site';

const SITE = SITE_URL;

const PAGES = {
  '/': {
    title: 'Dkit: secrets, cron and monitors, self-hosted',
    description: 'Self-hosted secrets manager with a CLI, dashboard and API. Run commands with env vars injected, schedule HTTP calls, watch URLs, and ship logs. Free while in beta.',
  },
  '/docs': {
    title: 'Dkit docs: CLI, API and self-hosting reference',
    description: 'Every dkit command, the HTTP API, env var rules, cron syntax and a self-hosting guide.',
  },
  '/changelog': {
    title: 'Dkit changelog',
    description: 'What shipped, in order, with dates.',
  },
  '/status': {
    title: 'Dkit status',
    description: 'Live uptime for the Dkit API, website and docs, updated every 30 seconds.',
  },
  '/tools': {
    title: 'Dkit tools: browser dev utilities',
    description: 'Secret and UUID generators, JWT decoder, SHA-256 hashes, epoch converter, base64, URL encoding and a cron string builder. Everything runs in your browser.',
  },
  '/login': {
    title: 'Log in to Dkit',
    description: 'Log in with your email and a one-time code.',
  },
  '/signup': {
    title: 'Create your Dkit account',
    description: 'Free while in beta. No card required.',
  },
  '/forgot-password': {
    title: 'Reset your Dkit password',
    description: 'We email you a link to choose a new password.',
  },
  '/reset-password': {
    title: 'Choose a new Dkit password',
    description: 'Pick a new password for your Dkit account.',
  },
};

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function applySeoMeta(pathname) {
  const path = (pathname || '/').split(/[?#]/)[0];
  const page = PAGES[path];
  const title = page ? page.title : 'Dkit';
  const description = page ? page.description : PAGES['/'].description;

  document.title = title;
  upsertMeta('name', 'description', description);

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = SITE + (page ? (path === '/' ? '/' : path) : '/');
}
