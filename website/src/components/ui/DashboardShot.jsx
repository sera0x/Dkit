import React from 'react';
import logo from '../../assets/dkit-logo.png';
import './DashboardShot.css';

// Stand-in for a product screenshot: the real dashboard rebuilt as plain,
// theme-token-driven markup. Static on purpose (no animation, no glow); it
// follows the marketing light/dark palette through the same CSS variables the
// rest of the page uses.
const DashboardShot = () => (
  <div className="dshot" aria-hidden="true">
    <div className="dshot-bar">
      <span className="dshot-dot" />
      <span className="dshot-dot" />
      <span className="dshot-dot" />
      <span className="dshot-url">dkit.name.ng/dashboard</span>
    </div>
    <div className="dshot-body">
      <aside className="dshot-side">
        <div className="dshot-brand"><img src={logo} alt="" className="dshot-logo" /><span>Dkit</span></div>
        <span className="dshot-nav on">Projects</span>
        <span className="dshot-nav">Secrets</span>
        <span className="dshot-nav">Cron</span>
        <span className="dshot-nav">Monitors</span>
        <span className="dshot-nav">Logs</span>
      </aside>
      <div className="dshot-main">
        <div className="dshot-head">
          <span className="dshot-h">payments-api</span>
          <span className="dshot-key">dk_9f2e…</span>
        </div>
        <div className="dshot-grid">
          <div className="dshot-card">
            <span className="dshot-label">env: production</span>
            <div className="dshot-row"><code>DATABASE_URL</code><span>••••••••</span></div>
            <div className="dshot-row"><code>STRIPE_SECRET_KEY</code><span>••••••••</span></div>
            <div className="dshot-row"><code>RESEND_FROM</code><span>••••••••</span></div>
          </div>
          <div className="dshot-card">
            <span className="dshot-label">cron</span>
            <div className="dshot-row"><code>nightly-rollup</code><span className="dshot-ok">ran 6m ago</span></div>
            <div className="dshot-row"><code>sync-invoices</code><span className="dshot-ok">ran 1h ago</span></div>
          </div>
          <div className="dshot-card">
            <span className="dshot-label">monitors</span>
            <div className="dshot-row"><code>api.payments.dev</code><span className="dshot-ok">up</span></div>
            <div className="dshot-row"><code>checkout.payments.dev</code><span className="dshot-ok">up</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default DashboardShot;
