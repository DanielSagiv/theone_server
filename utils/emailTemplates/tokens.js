/**
 * Visual tokens aligned with Figma (email welcome card) and mobile design skill (cool accent).
 *
 * Use explicit hex text colors — avoid CSS opacity on text (breaks in Gmail / Apple Mail dark mode).
 */

module.exports = {
  BG_OUTER: '#000000',
  BG_CARD: '#000000',
  BORDER_CARD: '#333333',
  RADIUS_CARD: '20px',
  /** Primary headings / emphasis */
  TEXT_PRIMARY: '#ffffff',
  /** Body copy (replaces white + opacity 0.8) */
  TEXT_SECONDARY: '#e6e6e6',
  /** Footer support line */
  TEXT_MUTED: '#a8a8a8',
  /** Copyright line */
  TEXT_COPYRIGHT: '#888888',
  ACCENT_RAY: '#B4C1EA',
  FONT_STACK: 'Arial, Helvetica, sans-serif',
  FONT_MONO: "'Courier New', Courier, monospace",
  BODY_PX: '15px',
  CTA_LABEL_PX: '14px',
  MAX_WIDTH_PX: '560',
};
