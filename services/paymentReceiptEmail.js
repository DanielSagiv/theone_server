/**
 * Post-charge receipt email (AWS SES).
 * Sent after a successful GOAT source charge; does not block the payment API response.
 */
const { sendEmail } = require('../utils/emailService');

function getApiPublicBaseUrl() {
  const raw = process.env.API_PUBLIC_URL || process.env.BACKEND_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}

function isReceiptEmailEnabled() {
  const v = process.env.SEND_PAYMENT_RECEIPT_EMAIL;
  return v === 'true' || v === '1';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * @param {object} params
 * @param {{ email?: string, firstName?: string }} params.user
 * @param {{ _id: import('mongoose').Types.ObjectId, amount?: number, currency?: string, card_last_four?: string, gp_transaction_id?: string }} params.payment
 * @param {string|null} [params.coeName]
 */
async function sendPaymentReceiptEmail({ user, payment, coeName }) {
  if (!isReceiptEmailEnabled()) {
    return;
  }

  const to = user?.email;
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    console.warn('[PaymentReceiptEmail] skipped: invalid recipient');
    return;
  }

  const paymentId = payment._id ? payment._id.toString() : String(payment);
  const base = getApiPublicBaseUrl();

  const amountNum =
    typeof payment.amount === 'number' ? payment.amount : Number(payment.amount);
  const currency = (payment.currency || 'USD').toUpperCase();
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.length === 3 ? currency : 'USD',
  }).format(Number.isFinite(amountNum) ? amountNum : 0);

  const lastFour = payment.card_last_four ? String(payment.card_last_four) : '****';
  const txnRef = payment.gp_transaction_id ? String(payment.gp_transaction_id) : '—';
  const experienceLabel =
    coeName && String(coeName).trim() ? String(coeName).trim() : 'Your purchase';

  const pdfPath = `/v1/payments/${paymentId}/invoice.pdf`;
  const jsonPath = `/v1/payments/${paymentId}/invoice`;
  const pdfUrl = base ? `${base}${pdfPath}` : null;
  const jsonUrl = base ? `${base}${jsonPath}` : null;
  const appDeepLink = `the1://invoice-view?paymentId=${encodeURIComponent(paymentId)}`;

  const subject = `Payment receipt — ${experienceLabel}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 24px; }
  .header { font-size: 22px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; }
  .gold { color: #b8860b; }
  .box { background: #f7f7f7; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .row { margin: 8px 0; }
  .label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .cta { display: inline-block; margin-top: 16px; padding: 12px 20px; background: #1a1a1a; color: #fff !important; text-decoration: none; border-radius: 8px; font-weight: 600; }
  .note { font-size: 13px; color: #666; margin-top: 24px; }
  .mono { font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all; }
</style></head><body>
<div class="container">
  <div class="header">THE1 — <span class="gold">Payment received</span></div>
  <p>Thank you. Your card was charged successfully.</p>
  <div class="box">
    <div class="row"><span class="label">Experience</span><br/><strong>${escapeHtml(experienceLabel)}</strong></div>
    <div class="row"><span class="label">Amount</span><br/><strong>${escapeHtml(formattedAmount)}</strong></div>
    <div class="row"><span class="label">Card</span><br/>•••• ${escapeHtml(lastFour)}</div>
    <div class="row"><span class="label">Transaction reference</span><br/><span class="mono">${escapeHtml(txnRef)}</span></div>
  </div>
  <p><a class="cta" href="${escapeHtmlAttr(appDeepLink)}">Open receipt in THE1 app</a></p>
  ${
    pdfUrl
      ? `<p class="note">PDF receipt (use the app while signed in to download; direct API URLs require authentication):<br/><a href="${escapeHtmlAttr(pdfUrl)}">${escapeHtml(pdfUrl)}</a></p>`
      : `<p class="note">Open the THE1 app → Cards and Payment History → this payment → <strong>View invoice / receipt</strong> to see or download your PDF.</p>`
  }
  ${
    jsonUrl
      ? `<p class="note">Invoice data (JSON): <a href="${escapeHtmlAttr(jsonUrl)}">${escapeHtml(jsonUrl)}</a></p>`
      : ''
  }
</div>
</body></html>`;

  const textParts = [
    'THE1 — Payment received',
    '',
    `Experience: ${experienceLabel}`,
    `Amount: ${formattedAmount}`,
    `Card: **** ${lastFour}`,
    `Transaction reference: ${txnRef}`,
    '',
    `Open in app: ${appDeepLink}`,
  ];
  if (pdfUrl) {
    textParts.push('', `PDF (API URL; sign in via app for access): ${pdfUrl}`);
  }
  if (jsonUrl) {
    textParts.push(`Invoice JSON: ${jsonUrl}`);
  }
  textParts.push('', '— THE1 Platform');

  await sendEmail({
    to,
    subject,
    html,
    text: textParts.join('\n'),
  });
}

module.exports = {
  sendPaymentReceiptEmail,
  getApiPublicBaseUrl,
  isReceiptEmailEnabled,
};
