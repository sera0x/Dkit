import React, { useState, useContext } from 'react';
import { ArrowRight, Copy, Check } from 'lucide-react';
import logo from '../../assets/dkit-mark.png';
import Orb from '../ui/Orb';
import { useAuth } from '../../context/AuthContext';
import { MarketingThemeContext } from '../app/MarketingShell';
import './sections.css';

const INSTALL_CMD = 'curl -fsSL https://dkit.name.ng/install.sh | sh';

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#security', label: 'Security' },
  { href: '#cli', label: 'CLI' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
];

const Hero = ({ onNavigate }) => {
  const { user } = useAuth();
  const theme = useContext(MarketingThemeContext);
  const [copied, setCopied] = useState(false);

  const go = (path) => (event) => {
    if (event) event.preventDefault();
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-inner">
          <button className="home-brand" onClick={go('/')} aria-label="Dkit home">
            <img src={logo} alt="" className="home-logo" />
            <span>Dkit</span>
          </button>
          <nav className="home-nav" aria-label="Main">
            {NAV.map((item) => (
              item.href.startsWith('#')
                ? <a key={item.href} href={item.href}>{item.label}</a>
                : <a key={item.href} href={item.href} onClick={go(item.href)}>{item.label}</a>
            ))}
          </nav>
          <div className="home-actions">
            <a className="home-github" href="https://github.com/sera0x/Dkit" rel="noopener">GitHub</a>
            <button className="btn btn-ghost btn-sm" onClick={go(user ? '/dashboard' : '/login')}>
              {user ? 'Dashboard' : 'Sign in'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={go(user ? '/dashboard' : '/signup')}>
              Get started
            </button>
          </div>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Secrets without the .env file.</h1>
            <p className="hero-sub">
              Dkit keeps each project's secrets per environment, encrypts them at rest,
              and injects them into your process when it starts. Your repo stays clean,
              and a leaked checkout leaks nothing.
            </p>
            <div className="hero-ctas">
              <button className="btn btn-primary" onClick={go(user ? '/dashboard' : '/signup')}>
                Create free account
                <ArrowRight width="16" height="16" />
              </button>
              <a className="btn btn-ghost" href="#cli">See the CLI</a>
            </div>
            <button className="install-line" onClick={copy} title="Copy install command">
              <span className="install-prompt">$</span>
              <code>{INSTALL_CMD}</code>
              <span className="install-copy">{copied ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}</span>
            </button>
            <p className="hero-note">Open source. Self-hosted. AES-256-GCM at rest.</p>
          </div>
          <div className="hero-orb" aria-hidden="true">
            <Orb
              hue={151}
              hoverIntensity={0.5}
              rotateOnHover
              backgroundColor={theme === 'light' ? '#f7f7f4' : '#0c0e11'}
            />
          </div>
        </div>
      </section>
    </div>
  );
};

export default Hero;
