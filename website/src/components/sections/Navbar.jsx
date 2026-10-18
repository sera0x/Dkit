import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X } from 'lucide-react';
import logo from '../../assets/dkit-logo.png';
import { useAuth } from '../../context/AuthContext';
import './sections.css';

const NAV_LINKS = [
  { path: '/docs', label: 'Docs' },
  { path: '/changelog', label: 'Changelog' },
  { path: '/tools', label: 'Tools' },
];

// No "dkit login" while someone is already mid-login/signup — the page itself
// is the auth form.
const AUTH_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password'];

// The close animation runs at var(--duration-quick) = 150ms; unmount a beat
// later so the exit is never clipped.
const CLOSE_MS = 170;

const Navbar = ({ onNavigate, currentPath }) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const closeTimer = useRef(null);
  const { user } = useAuth();
  const onAuthPage = AUTH_PATHS.includes((currentPath || '').split(/[?#]/)[0]);

  // Close = animate out first, unmount after. Reopening mid-close cancels the
  // timer and remounts (new key) so the open animation plays again.
  const closeDrawer = () => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      setOpen(false);
    }, CLOSE_MS);
  };

  const openDrawer = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setClosing(false);
    setMountKey((k) => k + 1);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Don't leave a pending unmount timer behind if the navbar unmounts mid-close.
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const go = (path) => { closeDrawer(); onNavigate ? onNavigate(path) : (window.location.href = path); };
  const toggle = () => (open && !closing ? closeDrawer() : openDrawer());

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <button className="navbar-brand" onClick={() => go('/')}>
          <img src={logo} alt="" className="navbar-logo" />
          <span>Dkit</span>
        </button>
        <div className="navbar-actions">
          {!onAuthPage && (user ? (
            <button className="cta-button ghost" onClick={() => go('/dashboard')}>dashboard</button>
          ) : (
            <button className="cta-button ghost" onClick={() => go('/login')}>dkit login</button>
          ))}
          <button className="icon-btn" aria-label="Open menu" aria-expanded={open} onClick={toggle}>
            {open ? <X width="16" height="16" /> : <Menu width="16" height="16" />}
          </button>
        </div>
      </div>

      {createPortal(
        (open || closing) && (
          <>
            <div
              key={'bd' + mountKey}
              className={'navbar-backdrop' + (closing ? ' is-closing' : '')}
              onClick={closeDrawer}
              aria-hidden="true"
            />
            <div key={mountKey} className={'navbar-drawer' + (closing ? ' is-closing' : '')} role="dialog" aria-label="Menu">
              <div className="navbar-drawer-header">
                <button className="navbar-brand" onClick={() => go('/')}>
                  <img src={logo} alt="" className="navbar-logo" />
                  <span>Dkit</span>
                </button>
                <button className="navbar-drawer-close" aria-label="Close menu" onClick={closeDrawer}>
                  <X width="16" height="16" />
                </button>
              </div>
              <nav className="navbar-drawer-links">
                {NAV_LINKS.map((l) => (
                  <button key={l.path} className="navbar-link" onClick={() => go(l.path)}>{l.label}</button>
                ))}
                {user && <button className="navbar-link" onClick={() => go('/dashboard')}>Dashboard</button>}
              </nav>
              {user && <div className="navbar-drawer-account">{user?.email}</div>}
            </div>
          </>
        ),
        document.body
      )}
    </header>
  );
};

export default Navbar;
