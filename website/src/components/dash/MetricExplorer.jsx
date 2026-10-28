import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';

const W = 720, H = 240, PAD = { t: 16, r: 12, b: 24, l: 40 };

const META = {
  envSets: { label: 'env vars set', color: 'var(--accent)' },
  injects: { label: 'secret injects', color: 'var(--accent-dim)' },
  projects: { label: 'projects created', color: '#7c8a80' },
  signups: { label: 'signups', color: '#3b82f6' },
};

function buildPath(values, max) {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const step = innerW / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [PAD.l + i * step, PAD.t + innerH - (v / max) * innerH]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return { line: d, area: `${d} L ${pts[pts.length - 1][0]} ${H - PAD.b} L ${pts[0][0]} ${H - PAD.b} Z`, pts };
}

export default function MetricExplorer({ loader, data: preloaded, title = 'Activity', defaultActive = 'envSets' }) {
  const { token } = useAuth();
  const [fetched, setFetched] = useState(null);
  const [err, setErr] = useState(false);
  const [active, setActive] = useState(defaultActive);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (preloaded) return undefined;
    let cancelled = false;
    (loader || api.getActivity)(token)
      .then((d) => { if (!cancelled) setFetched(d); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [token, preloaded, loader]);

  const data = preloaded || fetched;

  const measures = useMemo(() => {
    if (!data) return [];
    const s = data.series || {};
    return Object.keys(META)
      .map((id) => ({ id, ...META[id], data: s[id] }))
      .filter((m) => Array.isArray(m.data) && m.data.length);
  }, [data]);

  const measure = measures.find((m) => m.id === active) || measures[0];
  const max = useMemo(() => (measure ? Math.max(...measure.data, 1) * 1.15 : 1), [measure]);
  const { line, area, pts } = useMemo(() => (measure ? buildPath(measure.data, max) : { line: '', area: '', pts: [] }), [measure, max]);

  if (err) return null;

  if (!data) {
    return (
      <div className="dash-card metric-explorer">
        <div className="me-head"><h2>{title}</h2></div>
        <p className="me-total">Loading…</p>
      </div>
    );
  }

  if (!measure) {
    return (
      <div className="dash-card metric-explorer">
        <div className="me-head"><h2>{title}</h2></div>
        <p className="me-total">No activity yet.</p>
      </div>
    );
  }

  const total = measure.data.reduce((a, b) => a + b, 0);

  return (
    <div className="dash-card metric-explorer">
      <div className="me-head">
        <h2>{title}</h2>
        <span className="me-total">{total.toLocaleString()} {measure.label} · last {measure.data.length} weeks</span>
      </div>

      <div className="me-tabs" role="tablist" aria-label="Metrics">
        {measures.map((m) => (
          <button key={m.id} role="tab" aria-selected={m.id === measure.id}
            className={'me-tab' + (m.id === measure.id ? ' active' : '')}
            onClick={() => { setActive(m.id); setHover(null); }}>
            <span className="me-dot" style={{ background: m.color }} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="me-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="me-chart"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * W;
            const step = (W - PAD.l - PAD.r) / Math.max(1, measure.data.length - 1);
            const i = Math.round((x - PAD.l) / step);
            setHover(Math.max(0, Math.min(measure.data.length - 1, i)));
          }}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={PAD.l} x2={W - PAD.r}
              y1={PAD.t + (H - PAD.t - PAD.b) * (1 - f)}
              y2={PAD.t + (H - PAD.t - PAD.b) * (1 - f)}
              className="me-grid" />
          ))}
          <path d={area} className="me-area" style={{ fill: measure.color }} />
          <path d={line} className="me-line" style={{ stroke: measure.color }} />
          {hover !== null && pts[hover] && (
            <g>
              <line x1={pts[hover][0]} x2={pts[hover][0]} y1={PAD.t} y2={H - PAD.b} className="me-cursor" />
              <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" className="me-pt" style={{ fill: measure.color }} />
            </g>
          )}
        </svg>
        {hover !== null && pts[hover] && (
          <div className="me-tip" style={{ left: `${(pts[hover][0] / W) * 100}%` }}>
            <strong>{measure.data[hover]}</strong> {measure.label}
            <span>week of {data.weeks[hover]}</span>
          </div>
        )}
      </div>

      <div className="me-xlabels">
        {measure.data.map((_, i) => (
          <span key={i}>{i % 2 === 0 ? `w${i + 1}` : ''}</span>
        ))}
      </div>
    </div>
  );
}
