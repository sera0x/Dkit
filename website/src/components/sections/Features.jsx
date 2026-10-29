import React from 'react';
import './sections.css';

const ROWS = [
  {
    title: 'One secret set per environment',
    body: 'Development, staging, production, or your own names. Each project gets its own values, so a staging database URL cannot end up in production by accident.',
    lines: [
      ['cmd', '$ dkit env:set DATABASE_URL postgres://… -e production'],
      ['out', '✓ set DATABASE_URL for production'],
      ['gap', ''],
      ['cmd', '$ dkit env:diff staging production'],
      ['out', 'DATABASE_URL differs'],
      ['out', 'STRIPE_SECRET_KEY only in production'],
    ],
  },
  {
    title: 'Injected at runtime, never written',
    body: 'dkit run starts your process with the right values already in the environment. No .env file is created, and the child process exits with its own status code.',
    lines: [
      ['cmd', '$ dkit run -- npm start'],
      ['out', '✓ 12 secrets injected from production'],
      ['out', '✓ no .env file written'],
      ['gap', ''],
      ['out', 'Server listening on :3000'],
    ],
  },
  {
    title: 'Change a value without a redeploy',
    body: 'Every write keeps the previous value. Roll one key back, or compare environments before you promote a release. The dashboard masks values by default.',
    lines: [
      ['cmd', '$ dkit env:rollback STRIPE_SECRET_KEY'],
      ['out', '✓ restored previous value'],
      ['gap', ''],
      ['cmd', '$ dkit env:history STRIPE_SECRET_KEY'],
      ['out', '2 changes, most recent 4 minutes ago'],
    ],
  },
];

const Features = () => (
  <section className="section product" id="product">
    <div className="section-inner">
      <div className="section-head">
        <h2>The .env file is the weak link.</h2>
        <p>
          It gets copied between machines, pasted into chat, and committed by mistake.
          Dkit moves the values somewhere with access control, encryption, and a history
          you can actually inspect.
        </p>
      </div>

      <div className="feature-rows">
        {ROWS.map((row, index) => (
          <div className={'feature-row' + (index % 2 ? ' reverse' : '')} key={row.title}>
            <div className="feature-copy">
              <h3>{row.title}</h3>
              <p>{row.body}</p>
            </div>
            <div className="feature-snippet">
              {row.lines.map(([kind, text], i) => (
                kind === 'gap'
                  ? <div className="snippet-gap" key={i} />
                  : <div className={'snippet-line ' + kind} key={i}>{text}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="also">
        <div className="also-head">
          <h3>Also in the box</h3>
          <p>Useful once the secrets are already in one place. None of it is required to start.</p>
        </div>
        <div className="also-grid">
          <div><strong>Cron</strong><span>Human schedules like <code>daily 09:30</code>, with run history.</span></div>
          <div><strong>Monitors</strong><span>One email when a URL goes down, one when it recovers.</span></div>
          <div><strong>Logs</strong><span>A drain any app can POST to, with level and search filters.</span></div>
          <div><strong>Teams</strong><span>Owner, admin, and member roles on shared projects.</span></div>
        </div>
      </div>
    </div>
  </section>
);

export default Features;
