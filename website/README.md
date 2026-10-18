# Dkit website

React + Vite marketing site and dashboard. The production build is served
directly by the backend, so there's no separate web server to run.

```bash
npm install
npm run dev        # dev server; /api is proxied to localhost:3001
npm run build      # outputs dist/, which the backend serves
npm run lint
```

Auth, theming, and API access live in `src/lib/` and `src/context/`. See the
root README for the full picture.
