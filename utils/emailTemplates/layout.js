/**
 * Table-based HTML email layout: dark "The 1" card shell (Figma node 1874:47512).
 */

const { escapeHtml, escapeHtmlAttr } = require('./escape');
const T = require('./tokens');

/** Same path as mobile `SparkleUnionMark` (Figma Union) — horizontal sparkle + bar. */
const SPARKLE_UNION_PATH =
  'M30 0C30 0 31.241 5.20165 37.2217 5.34082L60 5.75488V6.73633L37.2217 7.15039C31.2289 7.31015 30 12.4912 30 12.4912C30 12.4912 28.667 7.30937 22.8096 7.15039L0 6.73633V5.75488L22.8096 5.34082C28.667 5.18184 30 0 30 0Z';

/**
 * Inline SVG matching app `SparkleUnionMark` / Figma node 1874:47514 (not a generic star).
 * @returns {string}
 */
function renderSparkleUnionSvg() {
  return `<svg width="60" height="14" viewBox="0 0 60 12.4912" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The 1" style="display:block;margin:0 auto;">
    <path d="${SPARKLE_UNION_PATH}" fill="#ffffff"/>
  </svg>`;
}

/**
 * Upper email card band: cool blue light streaks + fade to black (approx. Figma 1874:47513). Outlook falls back to solid bgcolor.
 * @returns {string} Full table row `<tr>...</tr>`
 */
function renderEmailHeaderBannerRow() {
  const style = [
    'background-color:#070a12',
    'background-image:linear-gradient(180deg,#1a2238 0%,rgba(10,14,24,0.92) 38%,#000000 100%),linear-gradient(118deg,transparent 32%,rgba(180,193,234,0.16) 48%,transparent 64%),linear-gradient(72deg,transparent 38%,rgba(80,100,160,0.11) 50%,transparent 68%)',
    'border-radius:20px 20px 0 0',
    'padding:28px 16px 26px 16px',
    'overflow:hidden',
  ].join(';');
  return `<tr>
    <td align="center" valign="middle" bgcolor="#070a12" style="${style}">
      ${renderSparkleUnionSvg()}
    </td>
  </tr>`;
}

/**
 * @returns {string} Centered sparkle only (legacy wrapper for tests / reuse).
 */
function renderSparkleHeader() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr>
      <td align="center" style="padding:10px;">${renderSparkleUnionSvg()}</td>
    </tr>
  </table>`;
}

/**
 * Horizontal rule inside the card.
 * @returns {string}
 */
function renderDivider() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
    <tr>
      <td style="height:1px;background-color:rgba(255,255,255,0.15);line-height:1px;font-size:1px;">&nbsp;</td>
    </tr>
  </table>`;
}

/**
 * Primary pill CTA (white fill, black label).
 * @param {{ href: string, label: string }} opts
 * @returns {string}
 */
function renderPrimaryCta(opts) {
  const { href, label } = opts;
  const safeHref = escapeHtmlAttr(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
    <tr>
      <td align="left" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:100px;mso-padding-alt:14px 40px;">
        <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
          style="display:inline-block;padding:14px 40px;font-family:${T.FONT_STACK};font-size:${T.CTA_LABEL_PX};font-weight:bold;color:#000000;text-decoration:none;border-radius:100px;line-height:normal;">
          ${safeLabel}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Secondary CTA outline (for less prominent actions).
 * @param {{ href: string, label: string }} opts
 * @returns {string}
 */
function renderSecondaryCta(opts) {
  const { href, label } = opts;
  const safeHref = escapeHtmlAttr(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0 0;">
    <tr>
      <td align="left" style="border:1px solid rgba(255,255,255,0.35);border-radius:100px;">
        <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
          style="display:inline-block;padding:12px 28px;font-family:${T.FONT_STACK};font-size:${T.CTA_LABEL_PX};font-weight:bold;color:#ffffff;text-decoration:none;border-radius:100px;line-height:normal;">
          ${safeLabel}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Bulleted list with star markers (Figma ✦).
 * @param {string[]} items Plain-text lines (escaped)
 * @returns {string}
 */
function renderBulletList(items) {
  const rows = (items || []).map((text) => {
    const safe = escapeHtml(text);
    return `<tr>
      <td style="vertical-align:top;padding:0 0 16px 0;width:28px;font-size:${T.BODY_PX};line-height:1.5;color:${T.TEXT_PRIMARY};font-family:${T.FONT_STACK};">&#10022;</td>
      <td style="vertical-align:top;padding:0 0 16px 0;font-size:${T.BODY_PX};line-height:1.5;color:${T.TEXT_SECONDARY};font-family:${T.FONT_STACK};">${safe}</td>
    </tr>`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${rows.join('')}</table>`;
}

/**
 * Large monospace verification / OTP code.
 * @param {string} code
 * @returns {string}
 */
function renderCodeBox(code) {
  const safe = escapeHtml(String(code));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:20px 0;">
    <tr>
      <td bgcolor="#0a0a12" style="background-color:#0a0a12;border:1px solid ${T.ACCENT_RAY};border-radius:12px;padding:20px;text-align:center;font-size:28px;font-weight:bold;letter-spacing:10px;color:${T.ACCENT_RAY};font-family:${T.FONT_MONO};">${safe}</td>
    </tr>
  </table>`;
}

/**
 * Bold single line (greeting / section title).
 * @param {string} text Escaped or raw — if raw, pass escape first
 * @returns {string}
 */
function renderBoldLine(text) {
  return `<p style="margin:0 0 16px 0;font-family:${T.FONT_STACK};font-size:${T.BODY_PX};line-height:1.5;font-weight:bold;color:${T.TEXT_PRIMARY};">${text}</p>`;
}

/**
 * Body paragraph (secondary text color; no CSS opacity — email-client safe).
 * @param {string} htmlOrText If you need HTML breaks, pass pre-escaped fragments; otherwise plain text escaped here
 * @param {{ rawHtml?: boolean }} opts
 * @returns {string}
 */
function renderMutedParagraph(text, opts = {}) {
  if (opts.rawHtml) {
    return `<p style="margin:0 0 16px 0;font-family:${T.FONT_STACK};font-size:${T.BODY_PX};line-height:1.5;color:${T.TEXT_SECONDARY};">${text}</p>`;
  }
  return `<p style="margin:0 0 16px 0;font-family:${T.FONT_STACK};font-size:${T.BODY_PX};line-height:1.5;color:${T.TEXT_SECONDARY};">${escapeHtml(text)}</p>`;
}

/**
 * Vertical spacer row.
 * @param {number} px
 * @returns {string}
 */
function renderSpacer(px) {
  const h = Math.max(0, Number(px) || 0);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr></table>`;
}

/**
 * Nested panel for transactional details (COE, booking, internal rows).
 * @param {string} innerHtml Trusted HTML only (built from escaped fields).
 * @returns {string}
 */
function renderDetailPanel(innerHtml) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:20px 0;">
    <tr>
      <td bgcolor="#141414" style="background-color:#141414;border-radius:12px;padding:20px;border-left:3px solid ${T.ACCENT_RAY};font-family:${T.FONT_STACK};font-size:${T.BODY_PX};line-height:1.5;color:${T.TEXT_SECONDARY};">${innerHtml}</td>
    </tr>
  </table>`;
}

/**
 * Small warning / legal line.
 * @param {string} text Plain text
 * @returns {string}
 */
function renderFinePrint(text) {
  return `<p style="margin:16px 0 0 0;font-family:${T.FONT_STACK};font-size:12px;line-height:1.5;color:${T.TEXT_MUTED};">${escapeHtml(text)}</p>`;
}

/**
 * Status badge text (no emoji).
 * @param {string} label
 * @returns {string}
 */
function renderStatusBadge(label) {
  const safe = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;"><tr><td bgcolor="#2a3148" style="background-color:#2a3148;color:${T.TEXT_PRIMARY};padding:8px 16px;border-radius:100px;font-family:${T.FONT_STACK};font-size:12px;font-weight:bold;">${safe}</td></tr></table>`;
}

/**
 * Admin note callout (COE).
 * @param {string} note Plain text
 * @returns {string}
 */
function renderAdminNotePanel(note) {
  const safe = escapeHtml(note);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:20px 0;">
    <tr>
      <td bgcolor="#1a1810" style="background-color:#1a1810;border:1px solid #6b5c2e;border-radius:12px;padding:16px;font-family:${T.FONT_STACK};font-size:${T.BODY_PX};line-height:1.5;color:${T.TEXT_SECONDARY};"><strong style="color:${T.TEXT_PRIMARY};font-weight:bold;">Note from your event manager:</strong><br/>${safe}</td>
    </tr>
  </table>`;
}

/**
 * Standard footer block: divider, support copy, copyright.
 * @param {{ footerNote?: string|null, brandName?: string }} opts
 * @returns {string}
 */
function renderFooterBlock(opts = {}) {
  const { footerNote, brandName = 'The 1' } = opts;
  const year = new Date().getFullYear();
  const supportRow =
    footerNote !== null && footerNote !== undefined && footerNote !== ''
      ? `<tr><td align="center" style="padding:20px 8px 8px 8px;font-family:${T.FONT_STACK};font-size:14px;line-height:1.5;color:${T.TEXT_MUTED};">${escapeHtml(footerNote)}</td></tr>`
      : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:8px;">
    <tr><td style="padding-top:8px;">${renderDivider()}</td></tr>
    ${supportRow}
    <tr><td align="center" style="padding:12px 8px 0 8px;font-family:${T.FONT_STACK};font-size:12px;line-height:1.5;color:${T.TEXT_COPYRIGHT};">&copy; ${year} ${escapeHtml(brandName)}. All rights reserved.</td></tr>
  </table>`;
}

/**
 * Full HTML document: preheader, card shell, sparkle, body, optional footer.
 * @param {{
 *   preheader?: string,
 *   bodyHtml: string,
 *   footerNote?: string|null,
 *   includeFooter?: boolean,
 *   brandName?: string
 * }} opts
 * @returns {string}
 */
function renderEmailDocument(opts) {
  const {
    preheader = '',
    bodyHtml,
    footerNote = 'If you have any questions, feel free to reach out to our support team.',
    includeFooter = true,
    brandName = 'The 1',
  } = opts;

  const pre = preheader
    ? `<div style="display:none;font-size:1px;color:#000000;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`
    : '';

  const footerHtml = includeFooter ? renderFooterBlock({ footerNote, brandName }) : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>The 1</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    :root { color-scheme: dark; supported-color-schemes: dark; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${T.BG_OUTER};color:${T.TEXT_PRIMARY};">
  ${pre}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${T.BG_OUTER}" style="width:100%;background-color:${T.BG_OUTER};">
    <tr>
      <td align="center" style="padding:24px 16px;background-color:${T.BG_OUTER};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${T.MAX_WIDTH_PX}" bgcolor="${T.BG_CARD}" style="width:100%;max-width:${T.MAX_WIDTH_PX}px;border:1px solid ${T.BORDER_CARD};border-radius:${T.RADIUS_CARD};background-color:${T.BG_CARD};">
          ${renderEmailHeaderBannerRow()}
          <tr>
            <td bgcolor="${T.BG_CARD}" style="padding:28px 40px 40px 40px;font-family:${T.FONT_STACK};font-size:${T.BODY_PX};color:${T.TEXT_PRIMARY};background-color:${T.BG_CARD};border-radius:0 0 ${T.RADIUS_CARD} ${T.RADIUS_CARD};">
              ${bodyHtml}
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Welcome / dashboard CTA target: explicit env, or FRONTEND_URL + legacy path, or marketing fallback.
 * @returns {string}
 */
function getWelcomeDashboardUrl() {
  const explicit = process.env.WELCOME_DASHBOARD_URL;
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim().replace(/\/+$/, '');
  }
  const fe = process.env.FRONTEND_URL || '';
  const base = String(fe).trim().replace(/\/+$/, '');
  if (base) {
    return `${base}/test/dashboard`;
  }
  return 'https://the1.vip';
}

module.exports = {
  renderSparkleUnionSvg,
  renderEmailHeaderBannerRow,
  renderSparkleHeader,
  renderDivider,
  renderPrimaryCta,
  renderSecondaryCta,
  renderBulletList,
  renderCodeBox,
  renderBoldLine,
  renderMutedParagraph,
  renderSpacer,
  renderDetailPanel,
  renderFinePrint,
  renderStatusBadge,
  renderAdminNotePanel,
  renderFooterBlock,
  renderEmailDocument,
  getWelcomeDashboardUrl,
};
