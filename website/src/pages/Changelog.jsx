import React from 'react';
import { History } from 'lucide-react';
import AppShell from '../components/app/AppShell';
import './changelog.css';

const ENTRIES = [
  {
    version: 'v2.0',
    title: 'Safer sessions, sharper product',
    items: [
      'Browser auth: refresh token moved to an httpOnly, SameSite=Lax cookie; access token stays in memory',
      'CSRF double-submit protection on refresh and logout, with a 30-second rotation grace for concurrent tabs',
      'Content-Security-Policy enabled and CORS limited to PUBLIC_URL plus local development origins',
      'Project API keys in the dashboard now live in tab memory only, never localStorage',
      'Redesigned marketing site and dashboard chrome: graphite palette, sans-serif UI, self-hosted fonts, no decorative 3D',
      'Positioning narrowed to secrets and runtime config; cron, monitors, and logs are secondary',
      'CLI 2.0: `env:set` now defaults to production like the rest of the env commands',
      'Dependency audit: zero known vulnerabilities in backend and website production trees',
    ],
  },
  {
    version: 'v0.5',
    title: 'Cron jobs, monitors, log drain',
    items: [
      'Cron jobs: schedule HTTP calls from the API (`dkit cron:add`, dashboard Cron tab)',
      'Uptime monitors: we probe your URLs and email you on down + recovery (`dkit monitor:add`)',
      'Log drain: ship logs over HTTP, tail from CLI or dashboard (`dkit logs:ship` / `logs:tail`)',
      'Dashboard key vault: reveal/copy of API keys works per-browser now (keys are hashed server-side, shown once)',
      'New templates: node-api (zero-dep), scheduled-job, static-site. Log-drain wiring in express-pg',
      'Secrets tab: download any environment as a .env file',
    ],
  },
  {
    version: 'v0.4',
    title: 'Real dashboard, real auth',
    items: [
      'Signup now requires email verification before the dashboard unlocks',
      'Login and signup actually call the backend; no more locally-fabricated sessions',
      'Dashboard: live project count, env var count, and store key count',
      'Slide-in side navigation on mobile, replacing the old dropdown menu',
    ],
  },
  {
    version: 'v0.3',
    title: 'The marketing site',
    items: [
      'New landing page: hero, feature walkthrough, live CLI demo',
      'Full HTTP + CLI documentation site',
      'Rate limiting and security headers across the API',
    ],
  },
  {
    version: 'v0.2',
    title: 'Projects and API keys',
    items: [
      'Multiple projects per account, each with its own API key',
      'Per-project scoping for environment variables and the key-value store',
    ],
  },
  {
    version: 'v0.1',
    title: 'The beginning',
    items: [
      'CLI login with email verification codes',
      'Environment variable storage (`dkit env:set` / `env:get` / `env:list`)',
      'Key-value store (`dkit store:set` / `store:get`)',
    ],
  },
];

const PageHeader = ({ Icon, title, subtitle }) => (
  <div className="page-header">
    <div className="page-header-icon"><Icon width="18" height="18" /></div>
    <div>
      <h1>{title}</h1>
      <p className="page-header-sub">{subtitle}</p>
    </div>
  </div>
);

export default function Changelog({ onNavigate }) {
  return (
    <AppShell active="changelog" onNavigate={onNavigate}>
      <div className="changelog-container">
        <PageHeader
          Icon={History}
          title="Changelog"
          subtitle="What's actually shipped, in order."
        />

        <div className="changelog-list">
          {ENTRIES.map((entry) => (
            <article className="changelog-entry" key={entry.version}>
              <div className="changelog-card">
                <div className="changelog-entry-header">
                  <span className="changelog-version">{entry.version}</span>
                  <h2>{entry.title}</h2>
                </div>

                <ul className="changelog-items">
                  {entry.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
