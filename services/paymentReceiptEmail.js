/**
 * Post-charge receipt email (AWS SES).
 * Sent after a successful GOAT source charge; does not block the payment API response.
 */
const { sendEmail, sendEmailWithAttachments, getAccountingEmail } = require('../utils/emailService');
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

  const amountNum =
    typeof payment.amount === 'number' ? payment.amount : Number(payment.amount);
  const currency = (payment.currency || 'USD').toUpperCase();
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.length === 3 ? currency : 'USD',
  }).format(Number.isFinite(amountNum) ? amountNum : 0);

  const lastFour = payment.card_last_four ? String(payment.card_last_four) : '****';
  const isCash = payment.payment_channel === 'cash';
  const adhocPaidByLine = formatAdhocPaidByLine(payment);
  const txnRef = payment.gp_transaction_id ? String(payment.gp_transaction_id) : '—';
  const experienceLabel =
    coeName && String(coeName).trim() ? String(coeName).trim() : 'Your purchase';

  const appDeepLink = `the1://invoice-view?paymentId=${encodeURIComponent(paymentId)}`;

  const payerFirstName = isAdhoc
    ? getAdhocPayerDisplayName(payment).split(' ')[0]
    : user?.firstName || 'there';

  const subject = isAdhoc
    ? `Invoice — ${experienceLabel}`
    : `Payment receipt — ${experienceLabel}`;

  const paymentMethodLine = adhocPaidByLine
    ? adhocPaidByLine
    : isCash
      ? 'Cash'
      : `Card •••• ${lastFour}`;

  const detailsInner = `
    <p style="margin:0 0 12px 0;font-weight:bold;color:#B4C1EA;font-size:15px;">${escapeHtml(experienceLabel)}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Amount:</strong> ${escapeHtml(formattedAmount)}</p>
    <p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Payment:</strong> ${escapeHtml(paymentMethodLine)}</p>
    ${
      isCash
        ? ''
        : `<p style="margin:8px 0;"><strong style="color:#ffffff;font-weight:bold;">Transaction reference:</strong><br/><span style="font-family:'Courier New',monospace;font-size:12px;word-break:break-all;">${escapeHtml(txnRef)}</span></p>`
    }
  `;

  const introLine = isAdhoc
    ? `Hi ${escapeHtml(payerFirstName)}, thank you. Your payment was received.`
    : isCash
      ? 'Thank you. Your cash payment was recorded successfully.'
      : 'Thank you. Your card was charged successfully.';

  /**
   * @param {boolean} hasPdfAttachment
   */
  function buildReceiptEmail(hasPdfAttachment) {
    const footerCopy = hasPdfAttachment
      ? 'Your invoice is attached to this email as a PDF. You can also open this receipt in the THE1 app.'
      : 'Open this receipt in the THE1 app to view your invoice.';

    const bodyHtml = [
      renderBoldLine('Payment received'),
      renderMutedParagraph(introLine, { rawHtml: true }),
      renderDetailPanel(detailsInner),
      renderPrimaryCta({ href: appDeepLink, label: 'Open receipt in THE1 app' }),
      renderMutedParagraph(footerCopy, { rawHtml: false }),
    ].join('');

    const html = renderEmailDocument({
      preheader: `${formattedAmount} — ${experienceLabel}`,
      bodyHtml,
    });

    const textParts = [
      isAdhoc ? 'THE1 — Invoice' : 'THE1 — Payment received',
      '',
      isAdhoc ? `Hi ${payerFirstName},` : '',
      hasPdfAttachment
        ? 'Your invoice is attached as a PDF.'
        : 'Open this receipt in the THE1 app to view your invoice.',
      '',
      `Experience: ${experienceLabel}`,
      `Amount: ${formattedAmount}`,
      `Payment: ${paymentMethodLine}`,
    ];
    if (!isCash) {
      textParts.push(`Transaction reference: ${txnRef}`);
    }
    textParts.push('', `Open in app: ${appDeepLink}`, '', '— The 1');

    const text = textParts
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');

    return { html, text };
  }

  let pdfAttachment = null;
  try {
    const paymentService = require('./paymentService');
    const invoiceService = require('./invoiceService');
    const ownerId =
      payment.user_id?._id?.toString?.() || payment.user_id?.toString?.();
    const invoiceData = await paymentService.getInvoiceData(paymentId, ownerId, {
      isAdmin: true,
    });
    const pdfBuffer = await invoiceService.generateInvoicePDF(invoiceData);
    pdfAttachment = {
      filename: `invoice-${invoiceData.invoice_number}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    };
  } catch (err) {
    console.error('[PaymentReceiptEmail] PDF generation failed, sending without attachment:', {
      payment_id: paymentId,
      error: err?.message || err,
    });
  }

  const { html, text } = buildReceiptEmail(Boolean(pdfAttachment));
  const accountingBcc = getAccountingEmail();

  if (pdfAttachment) {
    await sendEmailWithAttachments({
      to,
      bcc: accountingBcc,
      subject,
      html,
      text,
      attachments: [pdfAttachment],
    });
    console.log('[PaymentReceiptEmail] invoice sent:', {
      payment_id: paymentId,
      payment_channel: payment.payment_channel || 'card',
      to,
      bcc: accountingBcc,
      attachment: pdfAttachment.filename,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  await sendEmail({
    to,
    bcc: accountingBcc,
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
