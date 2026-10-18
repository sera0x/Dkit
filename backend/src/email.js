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
// Shared shell: light and neutral.
//
// Deliberately NOT the site's dark theme: clients like Gmail and Outlook apps
// strip <body> styles and partially ignore !important, so a dark design
// renders as broken white-on-white. A light email has nothing to defend:
// when a client strips every style below, what remains is dark text on a
// white page — degraded, but correct. Everything is table-based and inline
// because modern CSS is ignored in most clients.
//
// Type and color: one sans-serif stack for all
// prose (mono only for actual data values), brand green #39ff88 reserved for
// the primary CTA and success states, red for errors, neutral grays for
// everything else. The wordmark is plain text — no hosted logo, so nothing
// breaks when images are blocked.
//
// Every mail also carries a plain-text part: one-line intro, the code/link in
// plain form, expiry. That's what spam filters read and what terminal
// clients show.
// ---------------------------------------------------------------------------
const FONT = `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
const INK = '#1a1d1b'      // headings and strong text
const BODY = '#3f4542'     // body copy
const MUTED = '#7a837d'    // secondary copy and footnotes
const LINE = '#e3e7e4'     // hairlines and card borders
const CARD = '#f6f8f7'     // tinted panel (detail rows)
const GREEN = '#12b76a'    // CTA background: brand green, bright but white-text safe
const RED = '#d94b3e'      // error/down
const WHITE = '#ffffff'

function htmlShell({ title, introHtml, mainHtml, footnoteHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${WHITE}; background-color: ${WHITE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}">
<tr><td bgcolor="${WHITE}" align="center" style="padding: 40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px;">
  <tr><td align="center" style="padding-bottom: 24px;">
    <span style="font-family: ${FONT}; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; color: ${INK};">Dkit</span>
  </td></tr>
  <tr><td style="background: ${WHITE}; border: 1px solid ${LINE}; border-radius: 16px; padding: 28px 26px;">
    <h1 style="margin: 0 0 12px; font-family: ${FONT}; font-size: 21px; line-height: 1.3; font-weight: 700; letter-spacing: -0.01em; color: ${INK};">${escapeHtml(title)}</h1>
    ${introHtml}
    ${mainHtml}
  </td></tr>
  <tr><td style="padding: 24px 4px 8px; border-top: 1px solid ${LINE};">
    <p style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 1.6; color: ${MUTED}; text-align: center;">
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
const codeBlock = (code) => `
<div style="margin: 20px 0;">
  <div style="background: ${CARD}; border: 1px solid ${LINE}; border-radius: 14px; padding: 20px 16px; text-align: center;">
    <span style="font-family: 'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace; font-size: 32px; font-weight: 700; letter-spacing: 10px; color: ${INK};">${escapeHtml(code)}</span>
  </div>
</div>`

// The one place brand green is allowed to be loud: the primary action.
const linkButton = (url, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 22px 0;"><tr><td style="background: ${GREEN}; border-radius: 8px;">
  <a href="${escapeHtml(url)}" style="display: inline-block; padding: 13px 30px; font-family: ${FONT}; font-size: 14px; font-weight: 600; color: ${WHITE}; text-decoration: none; border-radius: 10px;">${escapeHtml(label)}</a>
</td></tr></table>`

const p = (html) => `<p style="margin: 0 0 14px; font-family: ${FONT}; font-size: 14px; line-height: 1.6; color: ${BODY};">${html}</p>`
const dim = (html) => `<p style="margin: 0 0 14px; font-family: ${FONT}; font-size: 12px; line-height: 1.6; color: ${MUTED};">${html}</p>`
const strong = (html) => `<strong style="color: ${INK}; font-weight: 600;">${html}</strong>`

// Label/value detail rows (uptime alerts): labels in muted sans, values in
// mono because they are data.
const detailRow = (label, valueHtml, valueColor) => `
<tr>
  <td style="padding: 8px 14px; font-family: ${FONT}; font-size: 12px; color: ${MUTED}; white-space: nowrap; vertical-align: top; width: 1%;">${label}</td>
  <td style="padding: 8px 14px; font-family: 'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace; font-size: 13px; line-height: 1.5; color: ${valueColor || INK}; word-break: break-all;">${valueHtml}</td>
</tr>`

const detailPanel = (rows) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0; background: ${CARD}; border: 1px solid ${LINE}; border-radius: 8px;">${rows}</table>`

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
