import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Menu, X, LogOut, Sun, Moon, LayoutGrid, BookOpen, Wrench } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import logo from '../../assets/dkit-mark.png';
import { applyChromeTheme, syncChrome, nudgeBrowserChrome } from '../../lib/browserChrome';
import { runThemeTransition } from '../../lib/themeTransition';
import '../../pages/dashboard.css';
import '../../pages/render-look.css';



export default function AppShell({ active, onNavigate, primaryNav, children }) {
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  const drawerTimer = useRef(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('dkit_theme') || 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    try { localStorage.setItem('dkit_theme', theme); } catch {  }
  }, [theme]);

  useLayoutEffect(() => { applyChromeTheme(theme); }, [theme]);
  useLayoutEffect(() => () => applyChromeTheme('dark'), []);

  useLayoutEffect(() => {
    syncChrome();
    const cancel = nudgeBrowserChrome({ keepPosition: true });
    return cancel;
  }, []);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return undefined; }
    return nudgeBrowserChrome({ keepPosition: true });
  }, [theme]);

  const toggleTheme = (event) => {
    runThemeTransition(() => {
      flushSync(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')));
    }, event);
  };

  const closeDrawer = () => {
    if (drawerTimer.current) return;
    setDrawerClosing(true);
    drawerTimer.current = setTimeout(() => {
      drawerTimer.current = null;
      setDrawerClosing(false);
      setDrawerOpen(false);
    }, 170);
  };

  const openDrawer = () => {
    clearTimeout(drawerTimer.current);
    drawerTimer.current = null;
    setDrawerClosing(false);
    setDrawerKey((k) => k + 1);
    setDrawerOpen(true);
  };

  useEffect(() => () => clearTimeout(drawerTimer.current), []);

  const goto = (path) => { closeDrawer(); onNavigate ? onNavigate(path) : (window.location.href = path); };
  const goHome = () => goto('/');
  const handleLogout = () => { logout(); goto('/'); };

  const quickLinks = (
    <>
      {user && (
        <button className={'dash-nav-item' + (active === 'dashboard' ? ' active' : '')} onClick={() => goto('/dashboard')}>
          <LayoutGrid width="16" height="16" /> Dashboard
        </button>
      )}
      <button className={'dash-nav-item' + (active === 'docs' ? ' active' : '')} onClick={() => goto('/docs')}>
        <BookOpen width="16" height="16" /> Docs
      </button>
      <button className={'dash-nav-item' + (active === 'tools' ? ' active' : '')} onClick={() => goto('/tools')}>
        <Wrench width="16" height="16" /> Tools
      </button>
    </>
  );

  const nav = (
    <nav className="dash-nav" onClick={() => closeDrawer()}>
      {primaryNav && (
        <>
          <span className="dash-side-chip">Workspace</span>
          {primaryNav}
          <hr className="dash-nav-divider" />
        </>
      )}
      <span className="dash-side-chip">Quick links</span>
      {quickLinks}
    </nav>
  );

  const accountSlot = user ? (
    <div className="dash-side-user">
      <div className="dash-user-row">
        <span className="dash-avatar">{(user?.email || '?').slice(0, 1).toUpperCase()}</span>
        <div className="dash-user-meta">
          <div className="dash-user-name">{user?.email?.split('@')[0] || 'account'}</div>
          <div className="dash-user-email">{user?.email}</div>
        </div>
      </div>
      <div className="dash-side-actions">
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle color theme" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <Sun width="14" height="14" /> : <Moon width="14" height="14" />}
        </button>
        <button className="dash-logout" onClick={handleLogout}><LogOut width="14" height="14" /> log out</button>
      </div>
    </div>
  ) : (
    <div className="dash-side-user">
      <div className="dash-side-actions">
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle color theme" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <Sun width="14" height="14" /> : <Moon width="14" height="14" />}
        </button>
        <button className="dash-login" onClick={() => goto('/login')}>dkit login</button>
      </div>
    </div>
  );

  const sidebar = (
    <aside className="dash-side">
      <button className="dash-side-header" onClick={goHome} title="Back to home">
        <img src={logo} alt="" className="dash-side-logo" />
        <span>Dkit</span>
      </button>
      {nav}
      {accountSlot}
    </aside>
  );

  const topbar = (
    <div className="dash-topbar">
      <button className="dash-topbar-brand" onClick={goHome}><img src={logo} alt="" />Dkit</button>
      <div className="dash-topbar-actions">
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle color theme">
          {theme === 'dark' ? <Sun width="16" height="16" /> : <Moon width="16" height="16" />}
        </button>
        {!user && <button className="cta-button ghost" onClick={() => goto('/login')}>log in</button>}
        <button className="icon-btn" aria-label="Open menu" onClick={openDrawer}><Menu width="16" height="16" /></button>
      </div>
    </div>
  );

  const drawer = (drawerOpen || drawerClosing) && (
    <>
      <div className={'dash-backdrop' + (drawerClosing ? ' is-closing' : '')} onClick={closeDrawer} aria-hidden="true" />
      <div key={drawerKey} className={'dash-drawer' + (drawerClosing ? ' is-closing' : '')} role="dialog" aria-label="Menu">
        <div className="dash-drawer-header">
          <button className="dash-side-header" onClick={goHome}><img src={logo} alt="" className="dash-side-logo" /><span>Dkit</span></button>
          <button className="dash-drawer-close" aria-label="Close menu" onClick={closeDrawer}><X width="16" height="16" /></button>
        </div>
        {nav}
        {accountSlot}
      </div>
    </>
  );

  return (
    <div className="dash-shell" data-theme={theme}>
      {sidebar}
      {topbar}
      {drawer}
      <main className="dash-main">
        <div className="dash-main-inner">{children}</div>
      </main>
    </div>
  );
}
