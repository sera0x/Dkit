import React from 'react';
import { Terminal } from '../ui/Terminal';
import './sections.css';

const TerminalDemo = () => (
  <section className="section cli" id="cli">
    <div className="section-inner cli-inner">
      <div className="cli-copy">
        <h2>Four commands, no .env.</h2>
        <p>
          The CLI is the same API the dashboard uses. Log in once, link a project,
          and run. Nothing is written to disk except the project link.
        </p>
        <ul className="cli-list">
          <li><code>dkit new</code> scaffolds a backend and links it to a project.</li>
          <li><code>dkit env:set</code> writes a value to one environment.</li>
          <li><code>dkit run</code> injects the values into any command.</li>
        </ul>
      </div>
      <div className="cli-terminal">
        <Terminal
          commands={[
            'dkit login',
            'dkit new payments-api --template express-pg',
            'dkit env:set DATABASE_URL postgres://… -e production',
            'dkit run -- npm start',
          ]}
          outputs={{
            0: ['✓ Logged in as you@example.com'],
            1: ['✓ Created project "payments-api"', '✓ Scaffolded 14 files'],
            2: ['✓ DATABASE_URL set for production'],
            3: ['✓ 12 secrets injected', 'Server listening on :3000'],
          }}
          typingSpeed={28}
          delayBetweenCommands={500}
        />
      </div>
    </div>
  </section>
);

export default TerminalDemo;
