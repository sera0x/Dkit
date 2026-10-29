import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './sections.css';

const CTA = ({ onNavigate }) => {
  const { user } = useAuth();
  const go = (path) => {
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  return (
    <section className="section cta" id="start">
      <div className="section-inner">
        <div className="cta-panel">
          <div>
            <h2>Stop committing secrets.</h2>
            <p>Create a free account, or run Dkit on your own server. Both use the same CLI.</p>
          </div>
          <div className="cta-actions">
            <button className="btn btn-primary" onClick={() => go(user ? '/dashboard' : '/signup')}>
              {user ? 'Open dashboard' : 'Create free account'}
              <ArrowRight width="16" height="16" />
            </button>
            <a className="btn btn-ghost" href="/docs" onClick={(e) => { e.preventDefault(); go('/docs'); }}>
              Read the docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTA;
