import React, { useEffect, useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import AppShell from '../components/app/AppShell';
import './tools.css';



function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="tool-btn" onClick={copy} disabled={!value}>
      {copied ? 'Copied' : label}
    </button>
  );
}

function ToolCard({ title, subtitle, wide, children }) {
  return (
    <section className={'tool-card' + (wide ? ' wide' : '')}>
      <h2>{title}</h2>
      {subtitle && <p className="tool-sub">{subtitle}</p>}
      {children}
    </section>
  );
}


const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*_-+=?',
};

function genSecret(len, sets) {
  const charset =
    (sets.upper ? SETS.upper : '') +
    (sets.lower ? SETS.lower : '') +
    (sets.digits ? SETS.digits : '') +
    (sets.symbols ? SETS.symbols : '');
  if (!charset || len < 1) return '';
  const out = [];
  const buf = new Uint8Array(len * 2 + 8);
  const max = 256 - (256 % charset.length);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      if (buf[i] < max) out.push(charset[buf[i] % charset.length]);
    }
  }
  return out.join('');
}

function SecretTool() {
  const [len, setLen] = useState(32);
  const [sets, setSets] = useState({ upper: true, lower: true, digits: true, symbols: false });
  const [value, setValue] = useState('');

  useEffect(() => { setValue(genSecret(len, sets)); }, [len, sets]);

  return (
    <>
      <div className="tool-row">
        <label className="tool-label">
          Length
          <input
            className="tool-input"
            type="number"
            min="8"
            max="128"
            value={len}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) setLen(Math.min(128, Math.max(8, n)));
            }}
          />
        </label>
        <div className="tool-checks">
          {Object.keys(SETS).map((k) => (
            <label key={k} className="tool-check">
              <input
                type="checkbox"
                checked={sets[k]}
                onChange={() => setSets((s) => ({ ...s, [k]: !s[k] }))}
              />
              {k}
            </label>
          ))}
        </div>
      </div>
      <div className="tool-out-row">
        <input className="tool-out" type="text" readOnly value={value} onFocus={(e) => e.target.select()} />
        <CopyButton value={value} />
      </div>
    </>
  );
}


function genUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

function UuidTool() {
  const [value, setValue] = useState(genUuid);
  return (
    <>
      <div className="tool-out-row">
        <input className="tool-out" type="text" readOnly value={value} onFocus={(e) => e.target.select()} />
        <CopyButton value={value} />
      </div>
      <button type="button" className="tool-btn" onClick={() => setValue(genUuid())}>New one</button>
    </>
  );
}


const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function nextRun(schedule, from = new Date()) {
  const s = String(schedule || '').trim().toLowerCase();
  const base = from.getTime();

  const interval = s.match(/^(\d+)\s*(s|m|h)$/);
  if (interval) {
    const ms = interval[2] === 's' ? interval[1] * 1000 : interval[2] === 'm' ? interval[1] * 60000 : interval[1] * 3600000;
    if (ms < 10000) return null;
    return Math.floor(base / ms) * ms + ms;
  }
  const daily = s.match(/^daily (\d{1,2}):(\d{2})$/);
  if (daily) {
    const d = new Date(base);
    d.setUTCHours(Number(daily[1]), Number(daily[2]), 0, 0);
    if (d.getTime() <= base) d.setUTCDate(d.getUTCDate() + 1);
    return d.getTime();
  }
  const weekly = s.match(/^(sun|mon|tue|wed|thu|fri|sat) (\d{1,2}):(\d{2})$/);
  if (weekly) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + ((DAY_NAMES.indexOf(weekly[1]) - d.getUTCDay() + 7) % 7));
    d.setUTCHours(Number(weekly[2]), Number(weekly[3]), 0, 0);
    if (d.getTime() <= base) d.setUTCDate(d.getUTCDate() + 7);
    return d.getTime();
  }
  return null;
}

function fmtIn(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'in under a minute';
  if (mins < 60) return 'in ' + mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return 'in ' + hrs + 'h ' + (mins % 60) + 'm';
  return 'in ' + Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h';
}

function CronTool() {
  const [mode, setMode] = useState('every');
  const [amount, setAmount] = useState(5);
  const [unit, setUnit] = useState('m');
  const [time, setTime] = useState('09:30');
  const [day, setDay] = useState('mon');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const schedule = useMemo(() => {
    if (mode === 'every') return amount > 0 ? `${amount}${unit}` : '';
    if (mode === 'daily') return /^\d{1,2}:\d{2}$/.test(time) ? `daily ${time}` : '';
    return /^\d{1,2}:\d{2}$/.test(time) ? `${day} ${time}` : '';
  }, [mode, amount, unit, time, day]);

  const invalidEvery = mode === 'every' && schedule !== '' && amount * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000) < 10000;
  const next = schedule && !invalidEvery ? nextRun(schedule) : null;

  return (
    <>
      <div className="tool-row">
        <label className="tool-label">
          Kind
          <select className="tool-select" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="every">Every interval</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        {mode === 'every' && (
          <>
            <label className="tool-label">
              Every
              <input
                className="tool-input"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
              />
            </label>
            <label className="tool-label">
              Unit
              <select className="tool-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="s">seconds</option>
                <option value="m">minutes</option>
                <option value="h">hours</option>
              </select>
            </label>
          </>
        )}
        {mode !== 'every' && (
          <>
            {mode === 'weekly' && (
              <label className="tool-label">
                Day
                <select className="tool-select" value={day} onChange={(e) => setDay(e.target.value)}>
                  {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            )}
            <label className="tool-label">
              Time (UTC)
              <input className="tool-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <div className="tool-out-row">
        <input
          className="tool-out"
          type="text"
          readOnly
          value={invalidEvery ? 'minimum interval is 10 seconds' : schedule || 'pick a time'}
          onFocus={(e) => e.target.select()}
        />
        <CopyButton value={invalidEvery || !schedule ? '' : schedule} />
      </div>
      <p className="tool-note">
        {next
          ? 'Next run ' + fmtIn(next - Date.now()) + ', ' + new Date(next).toISOString().replace('.000', '') + ' UTC.'
          : 'Pass this to dkit cron:add with -s, or the schedule field in the dashboard.'}
      </p>
    </>
  );
}


function b64urlDecode(part) {
  const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function JwtTool() {
  const [token, setToken] = useState('');

  const decoded = useMemo(() => {
    const t = token.trim();
    if (!t) return null;
    try {
      const parts = t.split('.');
      if (parts.length < 2) throw new Error('expected three dot-separated parts, found ' + parts.length);
      return {
        header: JSON.stringify(JSON.parse(b64urlDecode(parts[0])), null, 2),
        payload: JSON.stringify(JSON.parse(b64urlDecode(parts[1])), null, 2),
      };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }, [token]);

  return (
    <>
      <textarea
        className="tool-area"
        placeholder="eyJhbGciOi..."
        value={token}
        onChange={(e) => setToken(e.target.value)}
        spellCheck="false"
      />
      {decoded && !decoded.error && (
        <div className="tool-cols">
          <div>
            <p className="tool-note">Header</p>
            <pre className="tool-pre">{decoded.header}</pre>
          </div>
          <div>
            <p className="tool-note">Payload</p>
            <pre className="tool-pre">{decoded.payload}</pre>
          </div>
        </div>
      )}
      {decoded?.error && <p className="tool-note">Doesn't look like a JWT: {decoded.error}</p>}
      <p className="tool-note">Decoded locally. The signature isn't checked, so don't trust a token you didn't issue.</p>
    </>
  );
}


function utf8ToB64(str) {
  let bin = '';
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function Base64Tool() {
  const [mode, setMode] = useState('encode');
  const [input, setInput] = useState('');

  const output = useMemo(() => {
    if (!input) return '';
    try {
      return mode === 'encode' ? utf8ToB64(input) : b64ToUtf8(input);
    } catch {
      return null;
    }
  }, [input, mode]);

  return (
    <>
      <div className="tool-row">
        <button type="button" className={'tool-btn' + (mode === 'encode' ? ' on' : '')} onClick={() => setMode('encode')}>Encode</button>
        <button type="button" className={'tool-btn' + (mode === 'decode' ? ' on' : '')} onClick={() => setMode('decode')}>Decode</button>
      </div>
      <textarea className="tool-area" value={input} onChange={(e) => setInput(e.target.value)} spellCheck="false" placeholder={mode === 'encode' ? 'text to encode' : 'base64 to decode'} />
      {output !== null && output !== '' && (
        <div className="tool-out-row">
          <textarea className="tool-area out" readOnly value={output} onFocus={(e) => e.target.select()} />
          <CopyButton value={output} />
        </div>
      )}
      {output === null && <p className="tool-note">That isn't valid base64.</p>}
    </>
  );
}


function UrlTool() {
  const [mode, setMode] = useState('encode');
  const [input, setInput] = useState('');

  const output = useMemo(() => {
    if (!input) return '';
    try {
      return mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input.replace(/\+/g, '%20'));
    } catch {
      return null;
    }
  }, [input, mode]);

  return (
    <>
      <div className="tool-row">
        <button type="button" className={'tool-btn' + (mode === 'encode' ? ' on' : '')} onClick={() => setMode('encode')}>Encode</button>
        <button type="button" className={'tool-btn' + (mode === 'decode' ? ' on' : '')} onClick={() => setMode('decode')}>Decode</button>
      </div>
      <textarea className="tool-area" value={input} onChange={(e) => setInput(e.target.value)} spellCheck="false" placeholder={mode === 'encode' ? 'text to percent-encode' : 'encoded string'} />
      {output !== null && output !== '' && (
        <div className="tool-out-row">
          <textarea className="tool-area out" readOnly value={output} onFocus={(e) => e.target.select()} />
          <CopyButton value={output} />
        </div>
      )}
      {output === null && <p className="tool-note">That string has a broken percent-escape in it.</p>}
    </>
  );
}


function HashTool() {
  const [text, setText] = useState('');
  const [algo, setAlgo] = useState('SHA-256');
  const [hash, setHash] = useState('');

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!text) { setHash(''); return; }
      const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
      const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      if (alive) setHash(hex);
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [text, algo]);

  return (
    <>
      <div className="tool-row">
        <label className="tool-label">
          Algorithm
          <select className="tool-select" value={algo} onChange={(e) => setAlgo(e.target.value)}>
            <option>SHA-1</option>
            <option>SHA-256</option>
            <option>SHA-384</option>
            <option>SHA-512</option>
          </select>
        </label>
      </div>
      <textarea className="tool-area" value={text} onChange={(e) => setText(e.target.value)} spellCheck="false" placeholder="text to hash" />
      {hash && (
        <div className="tool-out-row">
          <textarea className="tool-area out" readOnly value={hash} onFocus={(e) => e.target.select()} />
          <CopyButton value={hash} />
        </div>
      )}
    </>
  );
}


function EpochTool() {
  const [stamp, setStamp] = useState('');
  const [local, setLocal] = useState('');

  const stampDate = useMemo(() => {
    const s = stamp.trim();
    if (!/^\d{10,13}$/.test(s)) return null;
    const n = Number(s);
    return new Date(s.length >= 13 ? n : n * 1000);
  }, [stamp]);

  const localDate = useMemo(() => {
    if (!local) return null;
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [local]);

  return (
    <>
      <div className="tool-row">
        <label className="tool-label grow">
          Timestamp (seconds or ms)
          <input className="tool-input" type="text" inputMode="numeric" value={stamp} onChange={(e) => setStamp(e.target.value)} placeholder="1770000000" />
        </label>
        <button type="button" className="tool-btn now" onClick={() => setStamp(String(Math.floor(Date.now() / 1000)))}>Now</button>
      </div>
      {stampDate && (
        <p className="tool-note mono">{stampDate.toISOString().replace('.000', '')} UTC · {stampDate.toString().slice(0, 24)}</p>
      )}
      <div className="tool-row">
        <label className="tool-label grow">
          Date and time
          <input className="tool-input" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
        </label>
      </div>
      {localDate && (
        <p className="tool-note mono">
          {Math.floor(localDate.getTime() / 1000)}s · {localDate.getTime()}ms · {localDate.toISOString().replace('.000', '')} UTC
        </p>
      )}
    </>
  );
}


export default function Tools({ onNavigate }) {
  return (
    <AppShell active="tools" onNavigate={onNavigate}>
      <div className="tools-container">
        <div className="page-header">
          <div className="page-header-icon"><Wrench width="18" height="18" /></div>
          <div>
            <h1>Tools</h1>
            <p className="page-header-sub">Small utilities that run in your browser. Nothing you type leaves the page.</p>
          </div>
        </div>

        <div className="tools-grid">
          <ToolCard title="Secret generator" subtitle="Random strings for API keys, tokens and passwords.">
            <SecretTool />
          </ToolCard>
          <ToolCard title="UUID" subtitle="Version 4 UUIDs from the browser's crypto module.">
            <UuidTool />
          </ToolCard>
          <ToolCard title="Cron builder" subtitle="Schedule strings dkit cron:add understands, with the next run previewed. Times are UTC." wide>
            <CronTool />
          </ToolCard>
          <ToolCard title="JWT decoder" subtitle="Paste a token to read its header and payload." wide>
            <JwtTool />
          </ToolCard>
          <ToolCard title="SHA hash" subtitle="SHA-1, SHA-256, SHA-384 or SHA-512 of any text.">
            <HashTool />
          </ToolCard>
          <ToolCard title="Epoch converter" subtitle="Unix timestamps to dates and back.">
            <EpochTool />
          </ToolCard>
          <ToolCard title="Base64" subtitle="Encode or decode text. Handles Unicode.">
            <Base64Tool />
          </ToolCard>
          <ToolCard title="URL encoder" subtitle="Percent-encode or decode a string.">
            <UrlTool />
          </ToolCard>
        </div>
      </div>
    </AppShell>
  );
}
