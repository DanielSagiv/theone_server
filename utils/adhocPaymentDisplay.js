/**
 * Human-readable copy for on-spot (adhoc) payments.
 */

/**
 * Resolve payer display name from adhoc snapshot or populated user.
 * @param {object} payment
 * @returns {string}
 */
function getAdhocPayerDisplayName(payment) {
  const fromSnapshot = payment?.adhoc_payer?.display_name;
  if (fromSnapshot && String(fromSnapshot).trim()) {
    return String(fromSnapshot).trim();
  }
  const user = payment?.user_id;
  if (user && typeof user === 'object') {
    const first = user.firstName || user.first_name || '';
    const last = user.lastName || user.last_name || '';
    const combined = `${first} ${last}`.trim();
    if (combined) return combined;
  }
  return 'Payer';
}

/**
 * Last four digits for display (falls back when charge not completed yet).
 * @param {object} payment
 * @returns {string}
 */
function getAdhocCardLastFour(payment) {
  const raw = payment?.card_last_four;
  if (raw != null && String(raw).trim()) {
    const digits = String(raw).replace(/\D/g, '');
    return digits.slice(-4) || '****';
  }
  return '****';
}

/**
 * @param {object} payment - Payment document or lean object
 * @returns {string|null} e.g. "Paid by Jane Guest with card ending with 4415"
 */
function formatAdhocPaidByLine(payment) {
  if (!payment || payment.payment_type !== 'adhoc') {
    return null;
  }
  const name = getAdhocPayerDisplayName(payment);
  const isGuest = payment?.adhoc_payer?.type === 'guest';
  if (payment.payment_channel === 'min_spend') {
    const the1 =
      payment?.is_the1_event === true ||
      payment?.coe_is_the1_event === true ||
      payment?.coe?.is_the1_event === true ||
      payment?.coe?.original_request_data?.is_the1_event === true;
    return the1
      ? 'Applied to buy in balance'
      : 'Applied to min spend balance';
  }
  if (payment.payment_channel === 'cash') {
    return isGuest
      ? `Paid by guest user ${name} in cash`
      : `Paid by ${name} in cash`;
  }
  const last4 = getAdhocCardLastFour(payment);
  return isGuest
    ? `Paid by guest user ${name} with card ending with ${last4}`
    : `Paid by ${name} with card ending with ${last4}`;
}

/**
 * Attach adhoc_payment_summary on a plain payment object for API responses.
 * @param {object} payment
 * @returns {object}
 */
function withAdhocPaymentSummary(payment) {
  if (!payment || payment.payment_type !== 'adhoc') {
    return payment;
  }
  const summary = formatAdhocPaidByLine(payment);
  if (!summary) {
    return payment;
  }
  return { ...payment, adhoc_payment_summary: summary };
}

/**
 * Bill-to block for invoices/receipts (actual on-spot payer, not COE billing owner).
 * @param {object} payment
 * @returns {{ name: string, email: string|null, phone: string|null }|null}
 */
function getAdhocInvoiceBillTo(payment) {
  if (payment?.payment_type !== 'adhoc' || !payment.adhoc_payer) {
    return null;
  }
  const name = payment.adhoc_payer.display_name?.trim();
  if (!name) {
    return null;
  }
  const owner = payment.user_id;
  const ownerEmail =
    owner && typeof owner === 'object' ? owner.email : null;
  const ownerPhone =
    owner && typeof owner === 'object' ? owner.phone : null;
  return {
    name,
    email: payment.adhoc_payer.email?.trim() || ownerEmail || null,
    phone: payment.adhoc_payer.phone?.trim() || ownerPhone || null,
  };
}

/**
 * Email address for sending invoice/receipt to the on-spot payer.
 * @param {object} payment - Completed adhoc payment
 * @param {{ email?: string }|null} [chargeUser] - User whose card was charged
 * @returns {string|null}
 */
function getAdhocReceiptRecipientEmail(payment, chargeUser) {
  if (payment?.payment_type !== 'adhoc') {
    return null;
  }
  const fromSnapshot = payment.adhoc_payer?.email;
  if (fromSnapshot && String(fromSnapshot).trim().includes('@')) {
    return String(fromSnapshot).trim();
  }
  if (payment.adhoc_payer?.type === 'guest') {
    return null;
  }
  if (chargeUser?.email && String(chargeUser.email).includes('@')) {
    return String(chargeUser.email).trim();
  }
  return null;
}

/**
 * Fail fast when receipt emails are enabled but payer has no deliverable address.
 * @param {object} adhocPayer
 * @param {{ email?: string }|null} chargeUser
 * @param {boolean} receiptsEnabled
 */
function assertAdhocReceiptEmailAvailable(adhocPayer, chargeUser, receiptsEnabled) {
  if (!receiptsEnabled) {
    return;
  }
  const snap = adhocPayer?.email?.trim();
  if (snap && snap.includes('@')) {
    return;
  }
  const userEmail = chargeUser?.email?.trim();
  if (userEmail && userEmail.includes('@')) {
    return;
  }
  if (adhocPayer?.type === 'guest') {
    throw new Error('Guest email is required to send the invoice');
  }
  throw new Error('Payer email is required to send the invoice');
}

module.exports = {
  getAdhocPayerDisplayName,
  getAdhocCardLastFour,
  formatAdhocPaidByLine,
  withAdhocPaymentSummary,
  getAdhocInvoiceBillTo,
  getAdhocReceiptRecipientEmail,
  assertAdhocReceiptEmailAvailable,
};
