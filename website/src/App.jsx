import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/sections/Navbar';
import Hero from './components/sections/Hero';
import Features from './components/sections/Features';
import Security from './components/sections/Security';
import TerminalDemo from './components/sections/TerminalDemo';
import CTA from './components/sections/CTA';
import Footer from './components/sections/Footer';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Docs from './pages/Docs';
import Status from './pages/Status';
import NotFound from './pages/NotFound';
import Changelog from './pages/Changelog';
import Tools from './pages/Tools';
import AcceptInvite from './pages/AcceptInvite';
import MarketingShell from './components/app/MarketingShell';
import ErrorBoundary from './components/ui/ErrorBoundary';
import SuspendedNotice from './components/ui/SuspendedNotice';
import { AuthProvider, useAuth } from './context/AuthContext';
import { restoreSession } from './lib/api';
import { getPendingInvite } from './lib/pendingInvite';
import { nudgeBrowserChrome } from './lib/browserChrome';
import { applySeoMeta } from './lib/seo';
function OAuthCallback({ onNavigate }) {
const { login } = useAuth();
useEffect(() => {
let cancelled = false;
const finish = async () => {
const restored = await restoreSession();
if (cancelled) return;
if (!restored?.token) { onNavigate ? onNavigate('/login') : (window.location.href = '/login'); return; }
login(restored.user, restored.token);
window.history.replaceState({}, '', '/dashboard');
onNavigate ? onNavigate('/dashboard') : (window.location.href = '/dashboard');
};
finish();
return () => { cancelled = true; };
}, []);
return null;
}
const APP_SHELL_PATHS = ['/dashboard', '/docs', '/changelog', '/status', '/tools', '/suspended', '/accept-invite'];
const KNOWN_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/oauth/callback', ...APP_SHELL_PATHS];
function MainContent() {
const [currentPath, setCurrentPath] = useState(window.location.pathname);
const { token, booting } = useAuth();
useEffect(() => {
const handlePopState = () => setCurrentPath(window.location.pathname);
window.addEventListener('popstate', handlePopState);
return () => window.removeEventListener('popstate', handlePopState);
}, []);
const navigate = (path) => { window.history.pushState({}, '', path); setCurrentPath(path.split(/[?#]/)[0]); };
const inviteRedirected = useRef(false);
useEffect(() => {
if (currentPath === '/dashboard' && !token && !booting) navigate('/login');
}, [currentPath, token, booting]);
useEffect(() => {
if (currentPath === '/dashboard' && token && !inviteRedirected.current && getPendingInvite()) {
inviteRedirected.current = true;
navigate('/accept-invite');
}
}, [currentPath, token]);
useEffect(() => nudgeBrowserChrome(), [currentPath]);
useEffect(() => applySeoMeta(currentPath), [currentPath]);
const isKnownPath = KNOWN_PATHS.includes(currentPath);
const isAppShellPage = APP_SHELL_PATHS.includes(currentPath) || !isKnownPath;
const isHomePage = currentPath === '/';
const isAuthPage = ['/login', '/signup', '/forgot-password', '/reset-password'].includes(currentPath);
const renderRoute = () => {
switch (currentPath) {
case '/login': return <MarketingShell><Navbar onNavigate={navigate} currentPath={currentPath} /><Login onNavigate={navigate} /><Footer onNavigate={navigate} currentPath={currentPath} /></MarketingShell>;
case '/signup': return <MarketingShell><Navbar onNavigate={navigate} currentPath={currentPath} /><Signup onNavigate={navigate} /><Footer onNavigate={navigate} currentPath={currentPath} /></MarketingShell>;
case '/forgot-password': return <MarketingShell><Navbar onNavigate={navigate} currentPath={currentPath} /><ForgotPassword onNavigate={navigate} /></MarketingShell>;
case '/reset-password': return <MarketingShell><Navbar onNavigate={navigate} currentPath={currentPath} /><ResetPassword onNavigate={navigate} /></MarketingShell>;
case '/oauth/callback': return <OAuthCallback onNavigate={navigate} />;
case '/docs': return <Docs onNavigate={navigate} />;
case '/status': return <Status onNavigate={navigate} />;
case '/changelog': return <Changelog onNavigate={navigate} />;
case '/tools': return <Tools onNavigate={navigate} />;
case '/accept-invite': return <AcceptInvite onNavigate={navigate} />;
case '/suspended': return <SuspendedNotice onNavigate={navigate} />;
case '/dashboard': if (!token) return null; return <Dashboard onNavigate={navigate} />;
case '/': return (<MarketingShell><Hero onNavigate={navigate} /><Features /><Security onNavigate={navigate} /><TerminalDemo /><CTA onNavigate={navigate} /><Footer onNavigate={navigate} currentPath={currentPath} /></MarketingShell>);
default: return <NotFound onNavigate={navigate} />;
}
};
return (
<div className="app" style={{ backgroundColor: 'var(--bg)', minHeight: '100vh', color: 'var(--text)' }}>
{!isAppShellPage && !isHomePage && !isAuthPage && <ErrorBoundary><Navbar onNavigate={navigate} currentPath={currentPath} /></ErrorBoundary>}
<ErrorBoundary>{renderRoute()}</ErrorBoundary>
{!isAppShellPage && !isHomePage && !isAuthPage && <ErrorBoundary><Footer onNavigate={navigate} currentPath={currentPath} /></ErrorBoundary>}
</div>
);
}
export default function App() { return (<AuthProvider><MainContent /></AuthProvider>); }
