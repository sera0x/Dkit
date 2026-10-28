const configured = import.meta.env.VITE_SITE_URL;

export const SITE_URL = (configured || (typeof window !== 'undefined' ? window.location.origin : ''))
  .replace(/\/+$/, '');
