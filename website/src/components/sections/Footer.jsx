import React from 'react';
import logo from '../../assets/dkit-logo.png';
import './sections.css';

const Footer = ({ onNavigate }) => {
  const go = (path) => (event) => {
    event.preventDefault();
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand-col">
          <div className="footer-brand">
            <img src={logo} alt="" className="home-logo" />
            <span>Dkit</span>
          </div>
          <p>Secrets and runtime config for small teams.</p>
        </div>

        <div className="footer-col">
          <h4>Product</h4>
          <a href="#product">Secrets</a>
          <a href="#security">Security</a>
          <a href="#cli">CLI</a>
          <a href="#start">Get started</a>
        </div>

        <div className="footer-col">
          <h4>Resources</h4>
          <a href="/docs" onClick={go('/docs')}>Docs</a>
          <a href="/changelog" onClick={go('/changelog')}>Changelog</a>
          <a href="/status" onClick={go('/status')}>Status</a>
          <a href="/tools" onClick={go('/tools')}>Tools</a>
        </div>

        <div className="footer-col">
          <h4>Project</h4>
          <a href="https://github.com/sera0x/Dkit" rel="noopener">GitHub</a>
          <a href="https://github.com/sera0x/Dkit/blob/main/SECURITY.md" rel="noopener">Security policy</a>
          <a href="https://github.com/sera0x/Dkit/blob/main/LICENSE" rel="noopener">License</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} Dkit</span>
        <span>Self-hosted. MIT licensed.</span>
      </div>
    </footer>
  );
};

export default Footer;
