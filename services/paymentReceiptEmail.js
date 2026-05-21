/**
 * Post-charge receipt email (AWS SES).
 * Sent after a successful GOAT source charge; does not block the payment API response.
 */
const { sendEmail } = require('../utils/emailService');
const {
  renderEmailDocument,
  renderPrimaryCta,
  renderMutedParagraph,
  renderBoldLine,
  renderDetailPanel,
  escapeHtml,
  escapeHtmlAttr,
} = require('../utils/emailTemplates');

function getApiPublicBaseUrl() {
  const raw = process.env.API_PUBLIC_URL || process.env.BACKEND_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}

function isReceiptEmailEnabled() {
  const v = process.env.SEND_PAYMENT_RECEIPT_EMAIL;
  return v === 'true' || v === '1';
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

  const detailsInner = `
    <p style="margin:0 0 12px 0;font-weight:bold;color:#B4C1EA;font-size:15px;">${escapeHtml(experienceLabel)}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Amount:</strong> ${escapeHtml(formattedAmount)}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Card:</strong> •••• ${escapeHtml(lastFour)}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Transaction reference:</strong><br/><span style="font-family:'Courier New',monospace;font-size:12px;word-break:break-all;">${escapeHtml(txnRef)}</span></p>
  `;

  const linkParagraphs = [];
  if (pdfUrl) {
    linkParagraphs.push(
      renderMutedParagraph(
        `${escapeHtml('PDF receipt (sign in via the app to download; direct API URLs require authentication):')}<br/><a href="${escapeHtmlAttr(pdfUrl)}" style="color:#B4C1EA;">${escapeHtml(pdfUrl)}</a>`,
        { rawHtml: true }
      )
    );
  } else {
    linkParagraphs.push(
      renderMutedParagraph(
        'Open the THE1 app, go to Cards and Payment History, open this payment, then use View invoice / receipt to see or download your PDF.',
        { rawHtml: false }
      )
    );
  }
  if (jsonUrl) {
    linkParagraphs.push(
      renderMutedParagraph(
        `${escapeHtml('Invoice data (JSON):')} <a href="${escapeHtmlAttr(jsonUrl)}" style="color:#B4C1EA;">${escapeHtml(jsonUrl)}</a>`,
        { rawHtml: true }
      )
    );
  }

  const bodyHtml = [
    renderBoldLine('Payment received'),
    renderMutedParagraph('Thank you. Your card was charged successfully.'),
    renderDetailPanel(detailsInner),
    renderPrimaryCta({ href: appDeepLink, label: 'Open receipt in THE1 app' }),
    ...linkParagraphs,
  ].join('');

  const html = renderEmailDocument({
    preheader: `${formattedAmount} charged — ${experienceLabel}`,
    bodyHtml,
  });

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
  textParts.push('', '— The 1');

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
