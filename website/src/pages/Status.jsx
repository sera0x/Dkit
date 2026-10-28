import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Wrench, Clock, RefreshCw, Check } from 'lucide-react';
import AppShell from '../components/app/AppShell';
import { api } from '../lib/api';
import './status.css';


const STATUS_META = {
  up: { label: 'operational', Icon: CheckCircle2, cls: 'ok' },
  down: { label: 'outage', Icon: AlertTriangle, cls: 'err' },
  maintenance: { label: 'maintenance', Icon: Wrench, cls: 'warn' },
  pending: { label: 'checking…', Icon: Clock, cls: 'off' },
};

function ServiceRow({ s }) {
  const eff = s.effective_status || s.status || 'pending';
  const meta = STATUS_META[eff] || STATUS_META.pending;
  const Icon = meta.Icon;
  const isDown = eff === 'down';
  return (
    <div className={'status-service' + (isDown ? ' down' : '')}>
      <div className="status-service-head">
        <div className="status-service-name">
          <span className={'status-pill ' + meta.cls} aria-hidden="true" />
          <strong>{s.name}</strong>
          {s.mode !== 'auto' && <span className="status-manual-chip">{s.mode === 'manual_down' ? 'maintenance' : 'pinned up'}</span>}
        </div>
        <span className={'status-service-state ' + meta.cls}>{meta.label}</span>
      </div>
      {s.description && <p className="status-service-desc">{s.description}</p>}
      <div className="status-service-meta">
        <span>
          {s.last_checked_at
            ? 'checked ' + new Date(s.last_checked_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
            : 'not checked yet'}
        </span>
        {s.last_latency_ms != null && <span> · {s.last_latency_ms} ms</span>}
        <span> · {Number(s.uptime_24h ?? 100).toFixed(2)}% uptime (24h)</span>
      </div>
    </div>
  );
}

function IncidentCard({ inc }) {
  const resolved = !!inc.resolved_at;
  const stateCls = resolved ? 'ok' : inc.state === 'monitoring' ? 'warn' : 'err';
  const svc = inc.service_name ? <span className="status-inc-svc">{inc.service_name}</span> : null;
  return (
    <div className={'status-incident' + (resolved ? ' resolved' : '')}>
      <div className="status-incident-head">
        <div className="status-incident-title">
          {svc}
          <strong>{inc.title}</strong>
        </div>
        <span className={'status-chip ' + stateCls}>{resolved ? 'resolved' : inc.state}</span>
        <span className="status-chip ghost">{inc.impact}</span>
      </div>
      <div className="status-updates">
        {(inc.updates || []).map((u) => (
          <div className="status-update" key={u.id}>
            <span className={'status-pill ' + (u.state === 'resolved' ? 'ok' : u.state === 'monitoring' ? 'warn' : 'err')} />
            <div>
              <p>{u.message}</p>
              <time>{new Date(u.created_at).toLocaleString()}</time>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Status({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const load = useCallback(async (opts) => {
    const manual = !!(opts && opts.manual);
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      setData(await api.getStatus());
      setError('');
      if (manual) {
        setJustRefreshed(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setJustRefreshed(false), 2000);
      }
    }
    catch (e) { setError(e.message || 'Could not load status.'); }
    finally {
      const wait = Math.max(0, 600 - (Date.now() - startedAt));
      setTimeout(() => setRefreshing(false), wait);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  const overall = data?.overall || 'operational';
  const banner = {
    operational: { cls: 'ok', text: 'All systems operational' },
    outage: { cls: 'err', text: 'Active outage. We’re on it' },
    maintenance: { cls: 'warn', text: 'Scheduled maintenance in progress' },
    degraded: { cls: 'warn', text: 'Partially degraded' },
  }[overall] || { cls: 'ok', text: 'All systems operational' };

  return (
    <AppShell active="status">
      <div className="status-wrap">
        <header className="status-hero">
          <div className="status-hero-top">
            <h1>Service status</h1>
            <button className="cta-button ghost" onClick={() => load({ manual: true })} disabled={refreshing}>
              {refreshing ? (
                <><RefreshCw width="14" height="14" className="spin" /> refreshing…</>
              ) : justRefreshed ? (
                <><Check width="14" height="14" /> refreshed</>
              ) : (
                <><RefreshCw width="14" height="14" /> refresh</>
              )}
            </button>
          </div>
          <div className={'status-banner ' + banner.cls}>
            <span className={'status-pill ' + banner.cls} />
            {banner.text}
            {data && <span className="status-banner-meta"> · updated {new Date(data.checked_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </div>
        </header>

        {error && <p className="auth-error">{error}</p>}

        <section className="status-services">
          {(data?.services || []).map((s) => <ServiceRow key={s.id} s={s} />)}
          {data && data.services.length === 0 && <p className="me-total">No services registered yet.</p>}
        </section>

        <section className="status-incidents">
          <h2>Incidents</h2>
          <p className="page-header-sub">Auto-posted when automated checks fail; updates appear here and on the admin dashboard.</p>
          {(data?.incidents || []).map((inc) => <IncidentCard key={inc.id} inc={inc} />)}
          {data && data.incidents.length === 0 && (
            <div className="status-no-incidents">
              <CheckCircle2 width="18" height="18" /> No incidents in the last 7 days.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
