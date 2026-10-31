import React, { useState, useContext } from 'react';
import { ArrowRight, Copy, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import logo from '../../assets/dkit-mark.png';
import ParticleOrb from '../ui/ParticleOrb';
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

const EASE = [0.22, 1, 0.36, 1];

const group = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.65, ease: EASE } },
};

const Hero = ({ onNavigate }) => {
  const { user } = useAuth();
  const theme = useContext(MarketingThemeContext);
  const [copied, setCopied] = useState(false);
  const reduce = useReducedMotion();

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

  const animate = reduce ? false : 'show';

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-inner">
          <button className="home-brand" onClick={go('/')} aria-label="Dkit home">
            <img src={logo} alt="" className="home-logo" />
            <span>Dkit</span>
          </button>
          <nav className="home-nav" aria-label="Main">
            {NAV.map((navItem) => (
              navItem.href.startsWith('#')
                ? <a key={navItem.href} href={navItem.href}>{navItem.label}</a>
                : <a key={navItem.href} href={navItem.href} onClick={go(navItem.href)}>{navItem.label}</a>
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
        <div className="hero-stage">
          <div className="hero-orb-layer">
            <ParticleOrb theme={theme} />
          </div>

          <motion.div
            className="hero-content"
            variants={group}
            initial={reduce ? false : 'hidden'}
            animate={animate}
          >
            <motion.p className="hero-eyebrow" variants={item}>
              <span className="hero-dot" aria-hidden="true" />
              Encrypted secrets &middot; runtime config
            </motion.p>

            <motion.h1 variants={item}>
              Secrets without the <span className="hero-accent">.env</span> file.
            </motion.h1>

            <motion.p className="hero-sub" variants={item}>
              Dkit keeps each project&apos;s secrets per environment, encrypts them at rest,
              and injects them into your process when it starts. Your repo stays clean,
              and a leaked checkout leaks nothing.
            </motion.p>

            <motion.div className="hero-ctas" variants={item}>
              <button className="btn btn-primary" onClick={go(user ? '/dashboard' : '/signup')}>
                Create free account
                <ArrowRight width="16" height="16" />
              </button>
              <a className="btn btn-ghost" href="#cli">See the CLI</a>
            </motion.div>

            <motion.button
              className="install-line"
              variants={item}
              onClick={copy}
              title="Copy install command"
            >
              <span className="install-prompt">$</span>
              <code>{INSTALL_CMD}</code>
              <span className="install-copy">{copied ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}</span>
            </motion.button>

            <motion.p className="hero-note" variants={item}>
              Open source. Self-hosted. AES-256-GCM at rest.
            </motion.p>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default Hero;
