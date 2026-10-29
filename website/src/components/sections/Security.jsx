import React from 'react';
import { LockKeyhole, KeyRound, ShieldCheck, History, Server } from 'lucide-react';
import './sections.css';

const ITEMS = [
  {
    icon: LockKeyhole,
    title: 'Encrypted at rest',
    body: 'Env values, env history, and TOTP secrets are sealed with AES-256-GCM under a key that never leaves the server. Losing the database alone does not expose them.',
  },
  {
    icon: KeyRound,
    title: 'Keys are hashed',
    body: 'Project API keys and refresh tokens are stored as SHA-256 hashes. The plaintext exists once, in the response that created it. Rotating a key kills the old one immediately.',
  },
  {
    icon: ShieldCheck,
    title: 'Sessions that stay out of reach',
    body: 'Browser sessions use an httpOnly refresh cookie, a CSRF token, and a short-lived access token held in memory. A script injected into the page cannot read the refresh token.',
  },
  {
    icon: History,
    title: 'A record of what changed',
    body: 'Every secret write keeps the previous value. The history API returns lengths, not values, so an audit does not turn into another copy of your secrets.',
  },
];

const Security = ({ onNavigate }) => {
  const go = (path) => (event) => {
    event.preventDefault();
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  return (
    <section className="section security" id="security">
      <div className="section-inner">
        <div className="section-head">
          <h2>Built for what you're trusting it with.</h2>
          <p>
            Dkit is small on purpose. There are few moving parts between a secret and the
            process that needs it, and the important paths are covered by tests.
          </p>
        </div>

        <div className="security-panel">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <div className="security-item" key={title}>
              <Icon width="18" height="18" strokeWidth={1.75} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="security-foot">
          <div className="security-selfhost">
            <Server width="17" height="17" strokeWidth={1.75} aria-hidden="true" />
            <span>Run it on your own server. Postgres, Redis, and one process serving the API and dashboard.</span>
          </div>
          <a href="/docs" onClick={go('/docs')}>Read the security notes</a>
        </div>
      </div>
    </section>
  );
};

export default Security;
