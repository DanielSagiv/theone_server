/**
 * Post-charge receipt email (AWS SES).
 * Sent after a successful GOAT source charge; does not block the payment API response.
 */
const { sendEmail, sendEmailWithAttachments } = require('../utils/emailService');
const {
  formatAdhocPaidByLine,
  getAdhocPayerDisplayName,
  getAdhocReceiptRecipientEmail,
} = require('../utils/adhocPaymentDisplay');
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
 * @param {{ email?: string, firstName?: string }} params.user - COE billing account (invoice owner)
 * @param {object} params.payment
 * @param {string|null} [params.coeName]
 * @param {string} [params.recipientEmail] - Explicit override
 * @param {{ email?: string }|null} [params.chargeUser] - Card holder for adhoc recipient fallback
 */
async function sendPaymentReceiptEmail({
  user,
  payment,
  coeName,
  recipientEmail,
  chargeUser,
}) {
  if (!isReceiptEmailEnabled()) {
    return;
  }

  const isAdhoc = payment?.payment_type === 'adhoc';
  const isGuestAdhoc = isAdhoc && payment?.adhoc_payer?.type === 'guest';

  let to = null;
  if (recipientEmail && String(recipientEmail).includes('@')) {
    to = String(recipientEmail).trim();
  } else if (isAdhoc) {
    to = getAdhocReceiptRecipientEmail(payment, chargeUser);
  }
  // Guest on-spot pay: never email the COE client when guest address was expected.
  if (!to && !isGuestAdhoc) {
    to = user?.email || null;
  }

  if (!to || typeof to !== 'string' || !to.includes('@')) {
    console.warn('[PaymentReceiptEmail] skipped: invalid recipient', {
      payment_id: payment?._id,
      payment_type: payment?.payment_type,
      adhoc_payer_type: payment?.adhoc_payer?.type,
      adhoc_payer_email: payment?.adhoc_payer?.email || null,
    });
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
  const adhocPaidByLine = formatAdhocPaidByLine(payment);
  const txnRef = payment.gp_transaction_id ? String(payment.gp_transaction_id) : '—';
  const experienceLabel =
    coeName && String(coeName).trim() ? String(coeName).trim() : 'Your purchase';

  const pdfPath = `/v1/payments/${paymentId}/invoice.pdf`;
  const jsonPath = `/v1/payments/${paymentId}/invoice`;
  const pdfUrl = base ? `${base}${pdfPath}` : null;
  const jsonUrl = base ? `${base}${jsonPath}` : null;
  const appDeepLink = `the1://invoice-view?paymentId=${encodeURIComponent(paymentId)}`;

  const payerFirstName = isAdhoc
    ? getAdhocPayerDisplayName(payment).split(' ')[0]
    : user?.firstName || 'there';

  const subject = isAdhoc
    ? `Invoice — ${experienceLabel}`
    : `Payment receipt — ${experienceLabel}`;

  const detailsInner = `
    <p style="margin:0 0 12px 0;font-weight:bold;color:#B4C1EA;font-size:15px;">${escapeHtml(experienceLabel)}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Amount:</strong> ${escapeHtml(formattedAmount)}</p>
    ${
      adhocPaidByLine
        ? `<p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Payment:</strong> ${escapeHtml(adhocPaidByLine)}</p>`
        : `<p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Card:</strong> •••• ${escapeHtml(lastFour)}</p>`
    }
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Transaction reference:</strong><br/><span style="font-family:'Courier New',monospace;font-size:12px;word-break:break-all;">${escapeHtml(txnRef)}</span></p>
  `;

  const linkParagraphs = [];
  if (isAdhoc) {
    linkParagraphs.push(
      renderMutedParagraph(
        'Your invoice is attached to this email as a PDF.',
        { rawHtml: false }
      )
    );
  } else if (pdfUrl) {
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
  if (!isAdhoc && jsonUrl) {
    linkParagraphs.push(
      renderMutedParagraph(
        `${escapeHtml('Invoice data (JSON):')} <a href="${escapeHtmlAttr(jsonUrl)}" style="color:#B4C1EA;">${escapeHtml(jsonUrl)}</a>`,
        { rawHtml: true }
      )
    );
  }

  const introLine = isAdhoc
    ? `Hi ${escapeHtml(payerFirstName)}, thank you. Your payment was received.`
    : 'Thank you. Your card was charged successfully.';

  const bodyHtml = [
    renderBoldLine(isAdhoc ? 'Payment received' : 'Payment received'),
    renderMutedParagraph(introLine, { rawHtml: true }),
    renderDetailPanel(detailsInner),
    ...(isAdhoc ? [] : [renderPrimaryCta({ href: appDeepLink, label: 'Open receipt in THE1 app' })]),
    ...linkParagraphs,
  ].join('');

  const html = renderEmailDocument({
    preheader: `${formattedAmount} charged — ${experienceLabel}`,
    bodyHtml,
  });

  const textParts = [
    isAdhoc ? 'THE1 — Invoice' : 'THE1 — Payment received',
    '',
    isAdhoc ? `Hi ${payerFirstName},` : '',
    isAdhoc ? 'Your invoice is attached as a PDF.' : '',
    '',
    `Experience: ${experienceLabel}`,
    `Amount: ${formattedAmount}`,
    adhocPaidByLine ? `Payment: ${adhocPaidByLine}` : `Card: **** ${lastFour}`,
    `Transaction reference: ${txnRef}`,
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === ''));
  if (!isAdhoc) {
    textParts.push('', `Open in app: ${appDeepLink}`);
    if (pdfUrl) {
      textParts.push('', `PDF (API URL; sign in via app for access): ${pdfUrl}`);
    }
    if (jsonUrl) {
      textParts.push(`Invoice JSON: ${jsonUrl}`);
    }
  }
  textParts.push('', '— The 1');

  const text = textParts.join('\n');

  if (isAdhoc) {
    try {
      const paymentService = require('./paymentService');
      const invoiceService = require('./invoiceService');
      const ownerId =
        payment.user_id?._id?.toString?.() || payment.user_id?.toString?.();
      const invoiceData = await paymentService.getInvoiceData(paymentId, ownerId, {
        isAdmin: true,
      });
      const pdfBuffer = await invoiceService.generateInvoicePDF(invoiceData);
      const filename = `invoice-${invoiceData.invoice_number}.pdf`;

      await sendEmailWithAttachments({
        to,
        subject,
        html,
        text,
        attachments: [
          {
            filename,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      console.log('[PaymentReceiptEmail] adhoc invoice sent:', {
        payment_id: paymentId,
        to,
        timestamp: new Date().toISOString(),
      });
      return;
    } catch (err) {
      console.error('[PaymentReceiptEmail] adhoc PDF attach failed, sending without attachment:', {
        payment_id: paymentId,
        error: err?.message || err,
      });
    }
  }

  await sendEmail({
    to,
    subject,
    html,
    text,
  });
}

module.exports = {
  sendPaymentReceiptEmail,
  getApiPublicBaseUrl,
  isReceiptEmailEnabled,
};
