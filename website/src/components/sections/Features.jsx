import React from 'react';
import './sections.css';

const Features = () => {
  return (
    <section className="features-section" id="features">
      <div className="features-container">
        <h2 className="features-title">One CLI. Two jobs.</h2>

        <div className="feature-row">
          <div className="feature-copy">
            <h3>One command to start</h3>
            <p>
              <code>dkit new</code> scaffolds a real backend and links it to
              a live Dkit project in one step. No .env file is created.
            </p>
          </div>
          <div className="feature-snippet">
            <div><span className="cmd">$ dkit new</span> payments-api --template express-pg</div>
            <div className="out">✓ Created Dkit project "payments-api"</div>
            <div className="out">✓ Scaffolded 14 files from express-pg</div>
            <div style={{ marginTop: '0.75rem' }}><span className="cmd">$</span> cd payments-api && npm run dev</div>
          </div>
        </div>

        <div className="feature-row reverse">
          <div className="feature-copy">
            <h3>One command every day</h3>
            <p>
              <code>dkit run</code> injects secrets straight into the
              process. Nothing touches disk. <code>env:diff</code> shows
              what differs between environments. <code>env:rollback</code>{' '}
              restores the previous value of any key.
            </p>
          </div>
          <div className="feature-snippet">
            <div><span className="cmd">$ dkit run --</span> npm start</div>
            <div className="out">✓ secrets injected, nothing written to disk</div>
            <div style={{ marginTop: '0.75rem' }}><span className="cmd">$ dkit env:diff</span> staging production</div>
            <div className="out">DATABASE_URL differs (masked)</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Features;
