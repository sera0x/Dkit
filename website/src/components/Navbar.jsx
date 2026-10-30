import React from 'react';
import logo from '../assets/dkit-mark.png';
import { Sun, Moon } from 'lucide-react';

export default function Navbar({ user, theme, toggleTheme, onNavigate }) {
  const goto = (path, e) => {
    if (e) e.preventDefault();
    onNavigate ? onNavigate(path) : (window.location.href = path);
  };

  return (
    <nav className="site-nav">
      <div className="nav-container">
        <a href="/" className="nav-brand" onClick={(e) => goto('/', e)}>
          <img src={logo} alt="Dkit" className="nav-logo" />
          <span>Dkit</span>
        </a>

        <div className="nav-links">
          <a href="/docs" onClick={(e) => goto('/docs', e)}>Docs</a>
          <a href="/changelog" onClick={(e) => goto('/changelog', e)}>Changelog</a>
        </div>

        <div className="nav-actions">
          {toggleTheme && (
            <button
              className="icon-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun width="16" height="16" /> : <Moon width="16" height="16" />}
            </button>
          )}

          {user ? (
            <button className="cta-button primary" onClick={() => goto('/dashboard')}>
              Dashboard
            </button>
          ) : (
            <button className="cta-button primary" onClick={() => goto('/login')}>
              Log in
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
