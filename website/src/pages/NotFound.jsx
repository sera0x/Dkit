import React from 'react';
import AppShell from '../components/app/AppShell';

function DeadFace() {
  return (
    <svg className="notfound-face" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="A dizzy, dead-looking face with X eyes">
      <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <g stroke="currentColor" strokeWidth="4.5" strokeLinecap="round">
        <line x1="25" y1="32" x2="39" y2="46" />
        <line x1="39" y1="32" x2="25" y2="46" />
        <line x1="57" y1="32" x2="71" y2="46" />
        <line x1="71" y1="32" x2="57" y2="46" />
      </g>
      <path d="M34 66 q7 -6 14 0 t14 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function NotFound() {
  return (
    <AppShell>
      <div className="notfound">
        <DeadFace />
        <p className="notfound-code">404</p>
        <h1>Page not found</h1>
        <p className="page-header-sub">
          Nothing lives at <code>{typeof window !== 'undefined' ? window.location.pathname : ''}</code>.
        </p>
      </div>
    </AppShell>
  );
}
