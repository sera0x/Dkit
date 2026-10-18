require('dotenv').config()
const { Resend } = require('resend')

if (!process.env.RESEND_API_KEY) {
  throw new Error('Missing required env var: RESEND_API_KEY. Set it in backend/.env')
}
const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'Dkit <noreply@dkit.name.ng>'
const APP_URL = process.env.PUBLIC_URL || 'https://dkit.name.ng'
const YEAR = new Date().getFullYear()

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------------------------------------------------------------------------
// Shared shell: dark, table-based, and defended.
//
// The dark theme is the brand (matching the site), so the mail is built dark
// with the classic guards rather than hoping the client cooperates:
//
//   - Nested <table role="presentation"> only — no flex/grid, so Outlook
//     Desktop lays it out exactly like everything else.
//   - Every surface carries a bgcolor attribute as well as an inline
//     background. bgcolor survives in Gmail's image-blocking view, Outlook
//     (which drops background-image) and clients that strip <body> styles —
//     so "stripped" degrades to dark-on-dark surfaces, not white-on-white.
//   - <meta color-scheme> tells Apple Mail/Gmail this is already dark, which
//     stops aggressive inversion (and darkens their light-mode canvas).
//   - The hero image is the hosted logo with alt text; when images are
//     blocked you still get a legible dark card with a white wordmark.
//   - One <style> block for mobile only (@media); everything that matters is
//     inline, and the query is purely additive.
//
// Type and color: one sans-serif stack for prose (mono only for actual data
// values), neon green #39ff88 reserved for the CTA and success states, red
// for errors, near-white for headings and a light gray for body copy — both
// measured against #161918 at >4.5:1.
//
// Every mail also carries a plain-text part: one-line intro, the code/link in
// plain form, expiry. That's what spam filters read and what terminal
// clients show.
// ---------------------------------------------------------------------------
const FONT = `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
const MONO = `'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace`
const BG = '#0a0b0a'       // page background
const SURFACE = '#161918'  // the card
const PANEL = '#101312'    // inset panels: code blocks, detail rows
const INK = '#ffffff'      // headings and strong text
const BODY = '#c9cfcb'     // body copy — 11:1 on SURFACE
const MUTED = '#8b948f'    // secondary copy, footnotes — 5.5:1 on SURFACE
const LINE = '#2a2f2c'     // hairlines and card borders
const ACCENT = '#39ff88'   // neon brand green: CTA background (black text on it)
const GREEN = '#12b76a'    // success/UP status text
const RED = '#ff6b5e'      // error/down
const WHITE = '#ffffff'
const HERO = `${APP_URL}/dkit-logo.png`   // 1408x768, served by the site

function htmlShell({ title, introHtml, mainHtml, footnoteHtml, preheader }) {
  const preheaderText = escapeHtml(preheader || title)
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>${escapeHtml(title)}</title>
<style type="text/css">
  @media (max-width: 620px) {
    .wrap { width: 100% !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    h1 { font-size: 19px !important; line-height: 1.35 !important; }
    .body { font-size: 16px !important; }
    .code { font-size: 26px !important; letter-spacing: 6px !important; }
    .btn a { display: block !important; text-align: center !important; padding: 14px 20px !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background: ${BG}; background-color: ${BG};">
<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${BG};">${preheaderText}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}">
<tr><td bgcolor="${BG}" align="center" class="px" style="padding: 32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width: 100%; max-width: 600px;">

  <tr><td style="padding: 0 0 22px;">
    <img src="${HERO}" width="600" alt="Dkit" style="display: block; width: 100%; max-width: 600px; height: auto; border: 0; border-radius: 12px 12px 0 0;" />
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SURFACE}" style="background: linear-gradient(180deg, rgba(10,11,10,0) 0%, ${SURFACE} 100%); height: 44px;">
      <tr><td height="44" bgcolor="${SURFACE}" style="height: 44px; line-height: 44px; font-size: 1px;">&nbsp;</td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="${SURFACE}" style="background: ${SURFACE}; border: 1px solid ${LINE}; border-top: 0; border-radius: 0 0 12px 12px; padding: 4px 26px 28px;">
    <span style="font-family: ${FONT}; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: ${WHITE};">Dkit</span>
    <h1 style="margin: 14px 0 14px; font-family: ${FONT}; font-size: 21px; line-height: 1.3; font-weight: 700; letter-spacing: -0.01em; color: ${INK};">${escapeHtml(title)}</h1>
    ${introHtml}
    ${mainHtml}
  </td></tr>

  <tr><td style="padding: 22px 4px 4px;">
    <p style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 1.7; color: ${MUTED}; text-align: center;">
      ${footnoteHtml}<br />&copy; ${YEAR} Dkit &middot; <a href="${APP_URL}" style="color: ${MUTED}; text-decoration: underline;">${APP_URL.replace(/^https?:\/\//, '')}</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// Codes are data, so they use mono — dark ink on a light tinted panel.
// Codes are data: mono, on an inset panel with a hairline — reads like a
// terminal chip without pretending to be a window chrome.
const codeBlock = (code) => `
<div style="margin: 20px 0;">
  <div style="background: ${PANEL}; border: 1px solid ${LINE}; border-radius: 10px; padding: 20px 16px; text-align: center;">
    <span class="code" style="font-family: ${MONO}; font-size: 30px; font-weight: 700; letter-spacing: 9px; color: ${WHITE};">${escapeHtml(code)}</span>
  </div>
</div>`

// The one place the neon accent is allowed to be loud: the primary action.
// Near-black text on #39ff88 is 14.9:1 — the strongest contrast in the mail.
const linkButton = (url, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" style="margin: 22px 0;"><tr><td style="background: ${ACCENT}; border-radius: 8px;">
  <a href="${escapeHtml(url)}" style="display: inline-block; padding: 13px 30px; font-family: ${FONT}; font-size: 14px; font-weight: 700; color: #0a0b0a; text-decoration: none; border-radius: 8px;">${escapeHtml(label)}</a>
</td></tr></table>`

const p = (html) => `<p class="body" style="margin: 0 0 14px; font-family: ${FONT}; font-size: 15px; line-height: 1.6; color: ${BODY};">${html}</p>`
const dim = (html) => `<p style="margin: 0 0 14px; font-family: ${FONT}; font-size: 12px; line-height: 1.6; color: ${MUTED};">${html}</p>`
const strong = (html) => `<strong style="color: ${INK}; font-weight: 600;">${html}</strong>`

// Label/value detail rows (uptime alerts): labels in muted sans, values in
// mono because they are data.
const detailRow = (label, valueHtml, valueColor) => `
<tr>
  <td style="padding: 8px 14px; font-family: ${FONT}; font-size: 12px; color: ${MUTED}; white-space: nowrap; vertical-align: top; width: 1%;">${label}</td>
  <td style="padding: 8px 14px; font-family: ${MONO}; font-size: 13px; line-height: 1.5; color: ${valueColor || INK}; word-break: break-all;">${valueHtml}</td>
</tr>`

const detailPanel = (rows) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="margin: 20px 0; background: ${PANEL}; border: 1px solid ${LINE}; border-radius: 8px;">${rows}</table>`

async function deliver(to, subject, html, text) {
  try {
    const { error } = await resend.emails.send({ from: FROM, to: [to], subject, html, text })
    if (error) { console.error('Email error:', error); return false }
    return true
  } catch (error) {
    console.error('Email send failed:', error)
    return false
  }
}

// ---------------------------------------------------------------------------
// The five mails.
// ---------------------------------------------------------------------------

function sendVerificationCode(email, code) {
  const html = htmlShell({
    title: 'Verify your email',
    preheader: `Code ${code} \u2014 expires in 10 minutes.`,
    introHtml: p('Enter this code to finish creating your account.'),
    mainHtml: codeBlock(code) + dim('This code expires in 10 minutes.'),
    footnoteHtml: `If you didn't sign up for Dkit, ignore this email.`,
  })
  const text = [
    'Verify your email',
    '',
    'Enter this code to finish creating your account:',
    '',
    code,
    '',
    'This code expires in 10 minutes.',
    '',
    `If you didn't sign up for Dkit, ignore this email.`,
    APP_URL,
  ].join('\n')
  return deliver(email, 'Your Dkit verification code', html, text)
}

function sendLoginCode(email, code) {
  const html = htmlShell({
    title: 'Your login code',
    preheader: `Code ${code} \u2014 expires in 10 minutes.`,
    introHtml: p('Use this code to finish signing in.'),
    mainHtml: codeBlock(code) + dim('This code expires in 10 minutes.'),
    footnoteHtml: `If you weren't signing in, ignore this email and your account stays as it was.`,
  })
  const text = [
    'Your login code',
    '',
    'Use this code to finish signing in:',
    '',
    code,
    '',
    'This code expires in 10 minutes.',
    '',
    `If you weren't signing in, ignore this email and your account stays as it was.`,
    APP_URL,
  ].join('\n')
  return deliver(email, 'Your Dkit login code', html, text)
}

function sendPasswordResetEmail(email, resetUrl) {
  const html = htmlShell({
    title: 'Reset your password',
    preheader: 'One click sets a new password. The link expires in 30 minutes.',
    introHtml: p('Use the button below to set a new password for ' + strong(escapeHtml(email)) + '.'),
    mainHtml:
      linkButton(resetUrl, 'Reset password') +
      dim('This link expires in 30 minutes and works once.') +
      dim(`Button not working? Paste this into your browser:<br /><a href="${escapeHtml(resetUrl)}" style="color: ${BODY}; word-break: break-all;">${escapeHtml(resetUrl)}</a>`),
    footnoteHtml: `If you didn't request a reset, ignore this email and your password stays unchanged.`,
  })
  const text = [
    'Reset your password',
    '',
    'Open this link to set a new password:',
    '',
    resetUrl,
    '',
    'This link expires in 30 minutes and works once.',
    '',
    `If you didn't request a reset, ignore this email and your password stays unchanged.`,
    APP_URL,
  ].join('\n')
  return deliver(email, 'Reset your Dkit password', html, text)
}

function sendTeamInviteEmail(email, inviteUrl, { teamName = 'a team', inviterEmail = '', role = 'member' } = {}) {
  const html = htmlShell({
    title: `You've been invited to ${escapeHtml(teamName)}`,
    preheader: `Join ${teamName} on Dkit \u2014 the invite expires in 7 days.`,
    introHtml: p(
      (inviterEmail ? strong(escapeHtml(inviterEmail)) + ' invited you' : `You've been invited`) +
      ` to join ${strong(escapeHtml(teamName))} on Dkit as ${strong(escapeHtml(role))}.`
    ),
    mainHtml:
      linkButton(inviteUrl, 'Accept invitation') +
      dim('Sign in with ' + strong(escapeHtml(email)) + ' — invitations only work for the address they were sent to.') +
      dim('This link expires in 7 days.'),
    footnoteHtml: `Not expecting this? Ignore the email and you won't be added to anything.`,
  })
  const text = [
    `You've been invited to ${teamName}`,
    '',
    (inviterEmail ? inviterEmail + ' invited you' : `You've been invited`) + ` to join ${teamName} on Dkit as ${role}.`,
    '',
    'Accept here:',
    inviteUrl,
    '',
    `Sign in with ${email} — invitations only work for the address they were sent to.`,
    'This link expires in 7 days.',
    '',
    `Not expecting this? Ignore the email and you won't be added to anything.`,
    APP_URL,
  ].join('\n')
  return deliver(email, `You've been invited to join ${teamName} on Dkit`, html, text)
}

// Uptime alert: sent when a monitor flips down (and again when it recovers).
// Two visually distinct variants so "back up" reads as good news at a glance.
function sendUptimeAlertEmail(email, { name, url, status, statusCode, error }) {
  const down = status === 'down'
  const reason = error || (statusCode ? 'HTTP ' + statusCode : 'unknown failure')
  const title = down ? 'Downtime: ' + name : 'Back up: ' + name
  const statusColor = down ? RED : GREEN
  const statusLabel = down ? 'DOWN' : 'UP'
  const html = htmlShell({
    title,
    preheader: down ? `${name} is down \u2014 ${reason}.` : `${name} is back up.`,
    introHtml: p(
      `<span style="font-family: ${FONT}; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; color: ${statusColor};">${statusLabel}</span><br />` +
      (down ? 'Your monitor is down' : 'Your monitor recovered') +
      (statusCode ? ' (HTTP ' + statusCode + ')' : '') + '.'
    ),
    mainHtml:
      detailPanel(
        detailRow('Name', escapeHtml(name)) +
        detailRow('URL', escapeHtml(url)) +
        detailRow(down ? 'Error' : 'Status', escapeHtml(reason), down ? RED : undefined)
      ) +
      (down ? dim('You will get one email when it comes back up — not one per failed check.') : dim('No action needed.')),
    footnoteHtml: 'Sent by a Dkit uptime monitor.',
  })
  const text = [
    title,
    '',
    (down ? 'Your monitor is DOWN' : 'Your monitor recovered') + (statusCode ? ' (HTTP ' + statusCode + ')' : '') + '.',
    '',
    name,
    url,
    reason,
    '',
    down ? 'You will get one email when it comes back up.' : 'No action needed.',
    APP_URL,
  ].join('\n')
  return deliver(email, (down ? '[DOWN] ' : '[UP] ') + name + ' — Dkit monitor', html, text)
}

// Welcome mail — sent once right after signup (before verification, so it
// doubles as confirmation that the address works).
function sendWelcomeEmail(email) {
  const html = htmlShell({
    title: 'Welcome to Dkit',
    introHtml: p('Your account is ready.'),
    mainHtml:
      linkButton(APP_URL + '/signup', 'Create your first project'),
    footnoteHtml: 'You are receiving this because someone signed up to Dkit with this address.',
  })
  const text = [
    'Welcome to Dkit',
    '',
    'Your account is ready. Create your first project:',
    APP_URL + '/signup',
    '',
    APP_URL,
  ].join('\n')
  return deliver(email, 'Welcome to Dkit', html, text)
}

// Admin broadcast — drafted in the admin dashboard, sent to users.
function sendAdminBroadcastEmail(email, { subject, body }) {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((para) => p(escapeHtml(para).replace(/\n/g, '<br />')))
    .join('')
  const html = htmlShell({
    title: subject,
    introHtml: paragraphs,
    mainHtml: '',
    footnoteHtml: 'Sent by the Dkit team.',
  })
  const text = [subject, '', String(body || '').trim(), '', APP_URL].join('\n')
  return deliver(email, subject, html, text)
}

module.exports = { sendVerificationCode, sendLoginCode, sendPasswordResetEmail, sendTeamInviteEmail, sendUptimeAlertEmail, sendWelcomeEmail, sendAdminBroadcastEmail }
