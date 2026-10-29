import React from 'react';
import { LayoutGrid, KeyRound, FolderKanban, Clock, Activity } from 'lucide-react';
import logo from '../../assets/dkit-logo.png';
import './DashboardShot.css';

const ROWS = [
  ['DATABASE_URL', 'postgres://prod…', '4m'],
  ['STRIPE_SECRET_KEY', '••••••••••••', '1h'],
  ['RESEND_API_KEY', '••••••••••••', '3d'],
  ['SESSION_SECRET', '••••••••••••', '1w'],
];

const DashboardShot = () => (
  <div className="dshot" aria-hidden="true">
    <div className="dshot-bar">
      <span className="dshot-dot" />
      <span className="dshot-dot" />
      <span className="dshot-dot" />
      <span className="dshot-url">dkit.name.ng/dashboard</span>
    </div>
    <div className="dshot-app">
      <aside className="dshot-side">
        <div className="dshot-brand"><img src={logo} alt="" className="dshot-logo" /><span>Dkit</span></div>
        <span className="dshot-group">Workspace</span>
        <span className="dshot-nav"><LayoutGrid width="13" height="13" />Overview</span>
        <span className="dshot-nav on"><KeyRound width="13" height="13" />Secrets</span>
        <span className="dshot-nav"><FolderKanban width="13" height="13" />Projects</span>
        <span className="dshot-group">Automate</span>
        <span className="dshot-nav"><Clock width="13" height="13" />Cron</span>
        <span className="dshot-nav"><Activity width="13" height="13" />Monitors</span>
      </aside>

      <div className="dshot-main">
        <div className="dshot-title-row">
          <div>
            <span className="dshot-project">payments-api</span>
            <span className="dshot-crumb">projects / payments-api</span>
          </div>
          <span className="dshot-health"><i />All systems normal</span>
        </div>

        <div className="dshot-tabs">
          <span>development</span>
          <span>staging</span>
          <span className="on">production</span>
        </div>

        <div className="dshot-table">
          <div className="dshot-thead"><span>Key</span><span>Value</span><span>Updated</span></div>
          {ROWS.map(([key, value, updated]) => (
            <div className="dshot-row" key={key}>
              <code>{key}</code>
              <code className="dshot-value">{value}</code>
              <span>{updated}</span>
            </div>
          ))}
        </div>

        <div className="dshot-activity">
          <span className="dshot-activity-title">Recent activity</span>
          <div className="dshot-event"><span>DATABASE_URL changed</span><span>4m</span></div>
          <div className="dshot-event"><span>STRIPE_SECRET_KEY rolled back</span><span>1h</span></div>
        </div>
      </div>
    </div>
  </div>
);

export default DashboardShot;
