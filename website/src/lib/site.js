// Canonical origin for the public site. Set VITE_SITE_URL at build time for a
// fixed domain; otherwise use the origin the app is served from, so localhost,
// tunnel hostnames and self-hosted domains all produce correct links.
const configured = import.meta.env.VITE_SITE_URL;

export const SITE_URL = (configured || (typeof window !== 'undefined' ? window.location.origin : ''))
  .replace(/\/+$/, '');
