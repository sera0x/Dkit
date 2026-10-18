import React from 'react';
import { Terminal } from '../ui/Terminal';
import SlicedWaves from '../ui/SlicedWaves';
import { MarketingThemeContext } from '../app/MarketingShell';
import './sections.css';

const TerminalDemo = () => {
  const theme = React.useContext(MarketingThemeContext);
  return (
    <section className="terminal-section" id="demo">
      <div className="terminal-background">
        <SlicedWaves
          key={theme}
          color1={theme === 'light' ? '#0a8447' : '#39ff88'}
          color2={theme === 'light' ? '#57c98d' : '#1f9955'}
          color3={theme === 'light' ? '#dcf2e4' : '#0b3a20'}
          columns={12}
          rows={6}
          barThickness={0.15}
          speed={0.25}
          opacity={0.3}
          mouseInteraction={true}
        />
      </div>
      <div className="terminal-content">
        <h2>The workflow</h2>
        <Terminal
          commands={[
            "dkit new payments-api --template express-pg",
            "cd payments-api && npm install",
            "dkit env:set DATABASE_URL postgres://... -e production",
            "npm run dev",
          ]}
          outputs={{
            0: ["✓ Created Dkit project \"payments-api\"", "✓ Scaffolded 14 files from express-pg"],
            1: ["added 62 packages in 3s"],
            2: ["✓ DATABASE_URL set for production"],
            3: ["Server running on :3000", "(no .env file was created)"],
          }}
          typingSpeed={40}
          delayBetweenCommands={600}
        />
      </div>
    </section>
  );
};

export default TerminalDemo;
