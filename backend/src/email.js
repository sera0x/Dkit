require('dotenv').config()
const { Resend } = require('resend')

if (!process.env.RESEND_API_KEY) {
  throw new Error('Missing required env var: RESEND_API_KEY. Set it in backend/.env')
}
const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'Dkit <noreply@dkit.name.ng>'
const APP_URL = process.env.PUBLIC_URL || 'https://dkit.name.ng'
const YEAR = new Date().getFullYear()

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------------------------------------------------------------------------
// Shared shell — implements /root/dkit-email-kit.html (the design mockup).
//
// Light-first: #F4F5F7 canvas, white 12px card, brand green accent
// (#12b76a buttons with near-black text, #067647 for links and eyebrows —
// no blue or purple anywhere), and the curved lockup as the header image.
// Structure is nested presentation tables with
// everything inline; the <style> block only carries mobile + dark-mode
// enhancements, so stripping it degrades to a correct light mail.
//
// Dark mode is an enhancement layer (Apple Mail / anything honoring
// prefers-color-scheme): canvas #111418, card #1B1F26, and explicit
// !important recolors per class — headings, body, code panel, detail table,
// footer and links are each targeted, so nothing ends up dark-on-dark.
// Gmail and Outlook keep the light version, which is the intended default.
//
// Outlook gets a VML roundrect behind every CTA (mso conditional) plus
// PixelsPerInch, so Word draws a real rounded button instead of a rectangle.
//
// Every mail also carries a plain-text part: one-line intro, the code/link in
// plain form, expiry. That's what spam filters read and what terminal
// clients show.
// ---------------------------------------------------------------------------
const FONT = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
const MONO = `'Courier New',Courier,monospace`

const PAGE = '#F4F5F7'      // canvas
const CARD = '#FFFFFF'      // content card
const BORDER = '#E5E7EB'    // card border
const INK = '#111827'       // headings / strong
const BODY = '#4B5563'      // body copy
const MUTED = '#6B7280'     // secondary copy
const FAINT = '#9CA3AF'     // footer copy
const GREEN_ACCENT = '#12b76a'  // brand green: buttons, wordmark dot (dark text on it)
const GREEN_INK = '#067647'     // brand green as text: links, eyebrows (5.7:1 on white)
const GREEN_ON_DARK = '#34d399' // the same role on the dark card
const GREEN_INFO = '#ECFDF5'    // info box
const GREEN_INFO_INK = '#065F46'
const PANEL = '#F8FAFC'     // code panel / detail rows
const DASH = '#CBD5E1'      // code panel border
const RED = '#DC2626'       // DOWN
const RED_BG = '#FEF2F2'
const RED_BORDER = '#FECACA'
const RED_INK = '#7F1D1D'
const GREEN = '#16A34A'     // UP
const GREEN_BG = '#F0FDF4'
const GREEN_BORDER = '#BBF7D0'
const GREEN_INK_UP = '#14532D'
const DARK_BTN = '#111827'  // neutral CTA
const BTN_FG = '#07130e'    // near-black on brand green (7.4:1)

const LOGO = `${APP_URL}/dkit-logo-curved.png`   // rounded lockup with an alpha fade at the bottom

const HELP_URL = `${APP_URL}/help`
const PREFS_URL = `${APP_URL}/settings/email`

const STYLE = `
  :root{color-scheme:light dark;supported-color-schemes:light dark;}
  @media only screen and (max-width:620px){
    .container{width:100%!important;}
    .cp{padding:28px 22px!important;}
    .h1{font-size:20px!important;line-height:28px!important;}
    .code{font-size:28px!important;letter-spacing:6px!important;}
    .btn a{width:100%!important;}
  }
  @media (prefers-color-scheme:dark){
    .page{background:#111418!important;}
    .card{background:#1B1F26!important;border-color:#2B313A!important;}
    .h1{color:#F3F4F6!important;}
    .eyebrow{color:${GREEN_ON_DARK}!important;}
    .lead,.note{color:#9CA3AF!important;}
    .note strong,.lead strong,.h1 span{color:#E5E7EB!important;}
    .codebox{background:#111418!important;border-color:#2B313A!important;}
    .code{color:#E5E7EB!important;}
    .info{background:#052E21!important;color:#A7F3D0!important;}
    .info strong{color:#D1FAE5!important;}
    .lead a,.note a,.info a{color:#6EE7B7!important;}
    .panel{background:#111418!important;border-color:#2B313A!important;}
    .clabel{color:#9CA3AF!important;}
    .cvalue,.cvalue a{color:#E5E7EB!important;}
    .divb{border-color:#2B313A!important;}
    .foot p{color:#9CA3AF!important;}
    .foot a{color:${GREEN_ON_DARK}!important;}
    .foot .fine{color:#6B7280!important;}
    .clabel,.cvalue,.foot p,.lead,.note{ -webkit-text-size-adjust:100%; }
  }
`

function htmlShell({ title, preheader, eyebrow, eyebrowColor = GREEN_INK, introHtml, mainHtml, footnoteHtml, to }) {
  const preheaderText = escapeHtml(preheader || title)
  const who = to ? `<a href="mailto:${escapeHtml(to)}" style="color:#6B7280;text-decoration:none;">${escapeHtml(to)}</a>` : `<a href="${APP_URL}" style="color:#6B7280;text-decoration:none;">dkit.name.ng</a>`
  return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(String(title).replace(/<[^>]+>/g, ''))} — Dkit</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style type="text/css">
  table,td,div,p,a{font-family:Arial,Helvetica,sans-serif!important;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
</style>
<![endif]-->
<style type="text/css">${STYLE}</style>
</head>
<body style="margin:0;padding:0;word-spacing:normal;background:${PAGE};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheaderText}&#847;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" class="page" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE};">
<tr>
<td align="center" style="padding:36px 16px 48px;">
  <table role="presentation" class="container" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
    <tr>
      <td align="center" style="padding:0 0 22px;">
        <a href="${APP_URL}" style="text-decoration:none;">
          <img src="${LOGO}" width="600" alt="Dkit" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:12px;" />
        </a>
      </td>
    </tr>
    <tr>
      <td class="card" style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="cp" style="padding:36px 40px 32px;">
              ${eyebrow ? `<p class="eyebrow" style="margin:0 0 8px;font-family:${FONT};font-size:11px;line-height:16px;color:${eyebrowColor};font-weight:700;letter-spacing:2px;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>` : ''}
              <h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:30px;color:${INK};font-weight:800;">${title}</h1>
              ${introHtml || ''}
              ${mainHtml || ''}
              ${footnoteHtml ? `<table role="presentation" class="divb" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid #EEF1F4;font-size:0;line-height:0;">&nbsp;</td></tr></table><div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div><p class="note" style="margin:0;font-family:${FONT};font-size:13px;line-height:24px;color:${MUTED};">${footnoteHtml}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td class="foot" align="center" style="padding:26px 24px 0;font-family:${FONT};">
        <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${MUTED};">
          Sent by <a href="${APP_URL}" style="color:${GREEN_INK};text-decoration:none;"><strong>Dkit</strong></a> &middot; dkit.name.ng
        </p>
        <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${FAINT};">
          You&rsquo;re receiving this email as ${who}
        </p>
        <p style="margin:0;font-size:12px;line-height:18px;color:${FAINT};">
          <a href="${HELP_URL}" style="color:${MUTED};text-decoration:underline;">Help center</a>
          &nbsp;&middot;&nbsp;
          <a href="${PREFS_URL}" style="color:${MUTED};text-decoration:underline;">Email preferences</a>
          &nbsp;&middot;&nbsp;
          <a href="${PREFS_URL}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
        </p>
        <p class="fine" style="margin:14px 0 0;font-size:11px;line-height:16px;color:#C3C9D1;">
          &copy; ${YEAR} Dkit &middot; dkit.name.ng<br>
          Please do not reply to this automated message.
        </p>
      </td>
    </tr>
  </table>
</td>
</tr>
</table>
</body>
</html>`
}

// Inline text links: brand blue with an underline — never default blue.
const link = (url, label) => `<a href="${escapeHtml(url)}" style="color:${GREEN_INK};text-decoration:underline;">${escapeHtml(label || url)}</a>`

const p = (html) => `<p class="lead" style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${BODY};">${html}</p>`
const dim = (html) => `<p class="note" style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:24px;color:${MUTED};">${html}</p>`
const strong = (html) => `<strong style="color:${INK};font-weight:700;">${html}</strong>`

// Dashed terminal-style chip for 6-digit codes.
const codeBlock = (code) => `
<table role="presentation" class="codebox" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;background:${PANEL};border:1px dashed ${DASH};border-radius:10px;"><tr>
  <td align="center" style="padding:22px 16px;">
    <span class="code" style="font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:10px;color:${INK};">${escapeHtml(code)}</span>
  </td>
</tr></table>`

// Soft blue note box — "didn't request this?" style reassurance.
const infoBox = (html) => `
<table role="presentation" class="info" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 4px;background:${GREEN_INFO};border-radius:8px;"><tr>
  <td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${GREEN_INFO_INK};">${html}</td>
</tr></table>`

// CTA: VML roundrect for Outlook behind a normal inline-styled anchor.
const button = (url, label, { tone = 'green', width } = {}) => {
  const bg = tone === 'dark' ? DARK_BTN : GREEN_ACCENT
  const fg = tone === 'dark' ? '#FFFFFF' : BTN_FG
  const w = width || Math.min(320, Math.max(200, label.length * 9 + 48))
  return `
<div style="margin:20px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" bgcolor="${bg}" style="border-radius:8px;mso-padding-alt:0;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(url)}" style="height:48px;v-text-anchor:middle;width:${w}px;" arcsize="17%" strokecolor="${bg}" fillcolor="${bg}">
          <w:anchorlock/>
          <center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(label)}</center>
        </v:roundrect>
        <![endif]-->
        <a href="${escapeHtml(url)}" style="background:${bg};border:1px solid ${bg};border-radius:8px;color:${fg};display:inline-block;font-family:${FONT};font-size:15px;font-weight:700;line-height:46px;text-align:center;text-decoration:none;width:${w}px;mso-hide:all;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
</div>`
}

// Status banner: pill + sentence on a tinted row with a colour rail.
const statusBanner = ({ tone, label, text }) => {
  const c = tone === 'up'
    ? { bg: GREEN_BG, bd: GREEN_BORDER, rail: GREEN, ink: GREEN_INK_UP }
    : { bg: RED_BG, bd: RED_BORDER, rail: RED, ink: RED_INK }
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
  <tr><td style="background:${c.bg};border:1px solid ${c.bd};border-left:4px solid ${c.rail};border-radius:8px;padding:14px 16px;font-family:${FONT};">
    <span style="display:inline-block;background:${c.rail};border-radius:999px;padding:3px 12px;font-size:11px;font-weight:700;color:#FFFFFF;letter-spacing:1px;">${escapeHtml(label)}</span>
    <span style="font-size:14px;color:${c.ink};">&nbsp;&nbsp;${text}</span>
  </td></tr>
</table>`
}

// Label/value rows — labels in sans, values in mono (they are data).
const detailTable = (rows) => `
<table role="presentation" class="panel" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${CARD};border:1px solid #EEF1F4;border-radius:10px;">
<tr><td style="padding:6px 18px 18px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
</td></tr>
</table>`

const detailRow = (label, valueHtml, { mono = true, color } = {}) => `
<tr>
  <td class="clabel" style="padding:12px 0;border-bottom:1px solid #F3F4F6;font-family:${FONT};font-size:13px;color:${MUTED};width:110px;vertical-align:top;">${escapeHtml(label)}</td>
  <td class="cvalue" style="padding:12px 0;border-bottom:1px solid #F3F4F6;font-family:${mono ? MONO : FONT};font-size:13px;color:${color || INK};word-break:break-all;">${valueHtml}</td>
</tr>`

const detailRowLast = (label, valueHtml, { mono = false, color } = {}) => `
<tr>
  <td class="clabel" style="padding:12px 0;font-family:${FONT};font-size:13px;color:${MUTED};vertical-align:top;">${escapeHtml(label)}</td>
  <td class="cvalue" style="padding:12px 0;font-family:${mono ? MONO : FONT};font-size:13px;color:${color || INK};">${valueHtml}</td>
</tr>`

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
// The mails.
// ---------------------------------------------------------------------------

function sendVerificationCode(email, code) {
  const html = htmlShell({
    title: 'Verify your email',
    preheader: `Code ${code} — expires in 10 minutes.`,
    eyebrow: 'Verification · dkit.name.ng',
    to: email,
    introHtml: p('Enter this code to finish creating your account.'),
    mainHtml:
      codeBlock(code) +
      dim('<strong>This code expires in 10 minutes.</strong> For your security, Dkit will never ask for it by phone or chat.') +
      infoBox('<strong>Didn&rsquo;t request this?</strong> You can safely ignore this email &mdash; your account stays exactly as it was.'),
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
    preheader: `Code ${code} — expires in 10 minutes.`,
    eyebrow: 'Sign in · dkit.name.ng',
    to: email,
    introHtml: p('Use this code to finish signing in.'),
    mainHtml:
      codeBlock(code) +
      dim('<strong>This code expires in 10 minutes.</strong> For your security, Dkit will never ask for it by phone or chat.') +
      infoBox('<strong>Weren&rsquo;t signing in?</strong> Ignore this email and your account stays exactly as it was.'),
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
    eyebrow: 'Password reset · dkit.name.ng',
    to: email,
    introHtml: p('Use the button below to set a new password for ' + strong(escapeHtml(email)) + '.'),
    mainHtml:
      button(resetUrl, 'Reset password') +
      dim('This link expires in 30 minutes and works once.') +
      infoBox(`Button not working? Paste this into your browser:<br><a href="${escapeHtml(resetUrl)}" style="color:${GREEN_INK};word-break:break-all;">${escapeHtml(resetUrl)}</a>`),
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
  const initials = (inviterEmail ? inviterEmail.split('@')[0] : 'dk').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'DK'
  const inviteRow = inviterEmail ? `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${PANEL};border:1px solid #EEF1F4;border-radius:10px;">
  <tr><td style="padding:16px 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td width="42" valign="middle">
          <div style="width:40px;height:40px;border-radius:50%;background:#D1FAE5;color:#047857;font-family:${FONT};font-size:15px;font-weight:700;line-height:40px;text-align:center;">${escapeHtml(initials)}</div>
        </td>
        <td style="padding-left:12px;font-family:${FONT};font-size:14px;line-height:21px;color:${BODY};">
          <a href="mailto:${escapeHtml(inviterEmail)}" style="color:${GREEN_INK};text-decoration:none;"><strong>${escapeHtml(inviterEmail)}</strong></a> invited you to join <strong style="color:${INK};">${escapeHtml(teamName)}</strong> on Dkit.
        </td>
        <td align="right" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#DCFCE7;border-radius:999px;padding:4px 12px;font-family:${FONT};font-size:11px;font-weight:700;color:#15803D;letter-spacing:1px;">${escapeHtml(String(role).toUpperCase())}</td>
          </tr></table>
        </td>
      </tr>
    </table>
  </td></tr>
</table>` : ''
  const html = htmlShell({
    title: `You&rsquo;ve been invited to <span style="color:${GREEN_INK};">${escapeHtml(teamName)}</span>`,
    preheader: `Join ${teamName} on Dkit — the invite expires in 7 days.`,
    eyebrow: 'Team invitation',
    to: email,
    introHtml: inviteRow + p(`Invitations only work for the address they were sent to (${strong(escapeHtml(email))}).`),
    mainHtml:
      button(inviteUrl, 'Accept invitation') +
      dim('This link expires in 7 days.'),
    footnoteHtml: `Not expecting this? Ignore the email and you won&rsquo;t be added to anything.`,
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
  const title = down ? `&#9679;&nbsp; ${escapeHtml(name)} is down` : `&#9679;&nbsp; ${escapeHtml(name)} is back up`
  const subject = down ? 'Downtime: ' + name : 'Back up: ' + name
  const html = htmlShell({
    title,
    preheader: down ? `${name} is down — ${reason}.` : `${name} is back up.`,
    eyebrow: 'Monitor alert',
    eyebrowColor: down ? RED : GREEN,
    to: email,
    introHtml: statusBanner({
      tone: down ? 'down' : 'up',
      label: down ? 'DOWN' : 'UP',
      text: down
        ? `${escapeHtml(reason)} &mdash; detected just now by Dkit&rsquo;s checker`
        : `Recovered &mdash; all checks passing`,
    }),
    mainHtml:
      (down
        ? detailTable(
            detailRow('Monitor', escapeHtml(name)) +
            detailRow('URL', `<a href="${escapeHtml(url)}" style="color:${GREEN_INK};text-decoration:none;">${escapeHtml(url)}</a>`) +
            detailRow('Error', escapeHtml(reason), { color: '#B91C1C' }) +
            detailRowLast('Since', 'just now')
          )
        : p(`Total downtime is recorded on the monitor. No action is needed.`)) +
      button(`${APP_URL}/dashboard`, down ? 'View monitor' : 'View uptime report', { tone: 'dark' }),
    footnoteHtml: down
      ? `We&rsquo;ll email you the moment it&rsquo;s back up &mdash; one message, not one per failed check.`
      : `Sent by a Dkit uptime monitor.`,
  })
  const text = [
    subject,
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
  const step = (n, head, sub) => `
  <tr>
    <td width="32" valign="top" style="font-family:${FONT};">
      <div style="width:24px;height:24px;border-radius:50%;background:#D1FAE5;color:#047857;font-size:13px;font-weight:700;line-height:24px;text-align:center;">${n}</div>
    </td>
    <td style="font-family:${FONT};font-size:14px;line-height:22px;color:${BODY};padding-bottom:14px;"><strong style="color:${INK};">${head}</strong><br>${sub}</td>
  </tr>`
  const html = htmlShell({
    title: 'Welcome to Dkit',
    preheader: 'Your account is ready — create your first project.',
    eyebrow: 'Getting started',
    to: email,
    introHtml: p('Your account is ready. Dkit gives your team secrets, cron jobs, uptime monitors and log shipping in one place. Here&rsquo;s how to get going:'),
    mainHtml: `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
  ${step(1, 'Create your first project', 'Connect a repo and get a dashboard in under two minutes.')}
  ${step(2, 'Invite your team', 'Collaboration works best with more than one person.')}
  ${step(3, 'Turn on monitoring', 'Get instant alerts the moment anything goes down.')}
</table>` +
      button(`${APP_URL}/signup`, 'Create your first project') +
      dim(`Questions? Visit the <a href="${HELP_URL}" style="color:${GREEN_INK};">help center</a>.`),
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
    title: escapeHtml(subject),
    preheader: 'A message from the Dkit team.',
    eyebrow: 'Product update',
    to: email,
    introHtml: paragraphs,
    mainHtml: '',
    footnoteHtml: 'Sent by the Dkit team.',
  })
  const text = [subject, '', String(body || '').trim(), '', APP_URL].join('\n')
  return deliver(email, subject, html, text)
}

module.exports = { sendVerificationCode, sendLoginCode, sendPasswordResetEmail, sendTeamInviteEmail, sendUptimeAlertEmail, sendWelcomeEmail, sendAdminBroadcastEmail }
