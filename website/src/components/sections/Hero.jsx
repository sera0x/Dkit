import React, { useState } from 'react';
import Orb from '../ui/Orb';
import logo from '../../assets/dkit-logo.png';
import DashboardShot from '../ui/DashboardShot';
import Shuffle from '../ui/Shuffle';
import { useAuth } from '../../context/AuthContext';
import { MarketingThemeContext } from '../app/MarketingShell';
import './sections.css';
const INSTALL_CMD = 'npm i -g dkit-cli';
const Hero = ({ onNavigate }) => {
const { user } = useAuth();
const theme = React.useContext(MarketingThemeContext);
const [copied, setCopied] = useState(false);
const copy = () => { navigator.clipboard?.writeText(INSTALL_CMD); setCopied(true); setTimeout(() => setCopied(false), 1500); };
const getStarted = () => { const target = user ? '/dashboard' : '/signup'; onNavigate ? onNavigate(target) : (window.location.href = target); };
return (
<section className="hero-section" id="top">
<button className="navbar-brand hero-brand-btn" onClick={() => (onNavigate ? onNavigate("/") : (window.location.href = "/"))}><img src={logo} alt="Dkit logo" className="navbar-logo" /><span>Dkit</span></button>
<button className="cta-button ghost hero-account-btn" onClick={() => { const t = user ? "/dashboard" : "/login"; onNavigate ? onNavigate(t) : (window.location.href = t); }}>{user ? "dashboard" : "dkit login"}</button>
<div className="hero-glow">
  <Orb hue={151} hoverIntensity={0.5} rotateOnHover={true}
    backgroundColor={theme === 'light' ? '#ffffff' : '#000000'} />
</div>
<div className="hero-grid">
<div className="hero-copy hero-seq">
<Shuffle text="Secrets, scaffolding, one CLI." shuffleDirection="right" duration={0.5} shuffleTimes={2} ease="power3.out" triggerOnce={true} triggerOnHover={true} tag="h1" textAlign="left" />
<div className="hero-subtitle"><p>Scaffold an Express + Postgres backend, keep env vars per environment, and run anything with secrets injected into the process. No .env file on disk.</p></div>
<div className="hero-ctas"><button className="cta-button primary" onClick={getStarted}>Get Started</button></div>
<div className="hero-install">
<button className="install-line" onClick={copy}><span>$ {INSTALL_CMD}</span><span className="install-copy">{copied ? 'copied' : 'copy'}</span></button>
<a href="#demo" className="hero-secondary-link">see it run ↓</a>
</div>
</div>
<div className="hero-terminal-wrap">
<DashboardShot />
</div>
</div>
</section>
);
};
export default Hero;
