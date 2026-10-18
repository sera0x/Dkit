import React from 'react';
import logo from '../../assets/dkit-logo.png';
import './sections.css';
const Footer = ({ onNavigate }) => {
const go = (path) => (e) => { e.preventDefault(); onNavigate ? onNavigate(path) : (window.location.href = path); };
return (
<footer className="footer">
<div className="footer-inner">
<div className="footer-brand"><img src={logo} alt="Dkit" className="navbar-logo" /><span>Dkit</span></div>
<div className="footer-links"><a href="#features">Product</a><a href="#demo">CLI</a><a href="#pricing">Pricing</a><a href="/docs" onClick={go('/docs')}>Docs</a><a href="/changelog" onClick={go('/changelog')}>Changelog</a><a href="/tools" onClick={go('/tools')}>Tools</a><a href="/status" onClick={go('/status')}>Status</a><a href="https://github.com/sera0x/Dkit" rel="noopener">GitHub</a><a href="/llms.txt" rel="noopener">llms.txt</a></div>
<p className="footer-copy">&copy; {new Date().getFullYear()} Dkit</p>
</div>
</footer>
);
};
export default Footer;
