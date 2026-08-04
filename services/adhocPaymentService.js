/**
 * Admin on-spot (adhoc) payment processing for COE / event scope.
 * @description GOAT charges that do not affect COE deposit/full payment_status.
 */
const Payment = require('../models/Payment');
const COE = require('../models/COE');
const User = require('../models/User');
const Event = require('../models/Event');
const goatClient = require('./goatClient');
const paymentService = require('./paymentService');
const {
  sendPaymentReceiptEmail,
  isReceiptEmailEnabled,
} = require('./paymentReceiptEmail');
const { assertAdhocReceiptEmailAvailable, getAdhocReceiptRecipientEmail } = require('../utils/adhocPaymentDisplay');

const PAYMENT_CONFIG = {
  currency: process.env.PAYMENT_CURRENCY || 'USD',
};

const {
  ensureGoatCustomerId,
  getCustomerDisplayName,
  detectCardBrand: detectCardBrandFromService,
} = paymentService;

/**
 * Resolve COE-linked payer user ids (primary client + accepted participants).
 * @param {import('mongoose').Document} coe
 * @returns {string[]}
 */
function getCoePayerUserIds(coe) {
  const ids = new Set();
  const clientId = coe.client_id?._id?.toString?.() || coe.client_id?.toString?.();
  if (clientId) ids.add(clientId);
  const participants = Array.isArray(coe.participants) ? coe.participants : [];
  for (const p of participants) {
    if (p.status !== 'accepted') continue;
    const uid = p.user_id?._id?.toString?.() || p.user_id?.toString?.();
    if (uid) ids.add(uid);
  }
  return [...ids];
}

/**
 * @param {string} coeId
 * @param {string} [eventId]
 * @returns {Promise<boolean>}
 */
function coeHasEventId(coe, eventId) {
  if (!eventId) return true;
  const events = Array.isArray(coe.events) ? coe.events : [];
  return events.some((ev) => {
    const eid = ev.event_id?._id?.toString?.() || ev.event_id?.toString?.();
    return eid === eventId;
  });
}

/**
 * Map saved methods for API (no sensitive data).
 * @param {import('mongoose').Document} user
 * @returns {object[]}
 */
function mapSavedCards(user) {
  return (user.saved_payment_methods || []).map((method) => ({
    token_id: method.token_id,
    card_brand: method.card_brand,
    card_last_four: method.card_last_four,
    expiry_month: method.expiry_month,
    expiry_year: method.expiry_year,
    is_default: method.is_default,
    nickname: method.nickname,
    created_at: method.created_at,
    last_used_at: method.last_used_at,
  }));
}

/**
 * Load admin adhoc payment screen options for a COE.
 * @param {string} coeId
 * @param {string} [eventId]
 * @returns {Promise<object>}
 */
async function getAdhocPaymentOptions(coeId, eventId) {
  const coe = await COE.findById(coeId)
    .populate('client_id', 'firstName lastName email phone')
    .lean();
  if (!coe) {
    throw new Error('Experience not found');
  }
  if (eventId && !coeHasEventId(coe, eventId)) {
    throw new Error('Event not found on this experience');
  }

  const payerUserIds = getCoePayerUserIds(coe);
  const users = await User.find({ _id: { $in: payerUserIds } }).select(
    'firstName lastName email phone saved_payment_methods default_payment_method role'
  );

  const payers = [];
  for (const uid of payerUserIds) {
    const user = users.find((u) => u._id.toString() === uid);
    if (!user) continue;
    const isPrimary =
      uid ===
      (coe.client_id?._id?.toString?.() || coe.client_id?.toString?.());
    payers.push({
      user_id: uid,
      type: isPrimary ? 'client' : 'participant',
      display_name: getCustomerDisplayName(user),
      email: user.email || null,
      phone: user.phone || null,
      saved_cards: mapSavedCards(user),
      default_payment_method: user.default_payment_method || null,
    });
  }

  const eventLines = [];
  for (const ev of coe.events || []) {
    const eid = ev.event_id?._id?.toString?.() || ev.event_id?.toString?.();
    if (!eid) continue;
    let title = null;
    try {
      const eventDoc = await Event.findById(eid).select('name title').lean();
      title = eventDoc?.name || eventDoc?.title || null;
    } catch {
      title = null;
    }
    eventLines.push({
      event_id: eid,
      event_date: ev.event_date,
      event_time: ev.event_time,
      title: title || `Event ${eid.slice(-6)}`,
      sequence: ev.sequence,
    });
  }

  let selectedEvent = null;
  if (eventId) {
    selectedEvent = eventLines.find((e) => e.event_id === eventId) || null;
  }

  return {
    coe: {
      id: coe._id.toString(),
      name: coe.name,
      currency: coe.currency || PAYMENT_CONFIG.currency,
      client_id: coe.client_id?._id?.toString?.() || coe.client_id?.toString?.(),
      adhoc_collected_total: coe.adhoc_collected_total || 0,
    },
    payers,
    events: eventLines,
    selected_event: selectedEvent,
  };
}

/**
 * Validate payer is allowed on this COE.
 * @param {import('mongoose').Document} coe
 * @param {string} payerUserId
 */
function assertPayerOnCoe(coe, payerUserId) {
  const allowed = getCoePayerUserIds(coe);
  if (!allowed.includes(payerUserId)) {
    throw new Error('Payer is not linked to this experience');
  }
}

/**
 * GOAT charge metadata for adhoc payments (guest name on GOAT; COE tag for reporting).
 * @param {import('mongoose').Document} payment
 * @param {import('mongoose').Document} chargeUser
 * @param {import('mongoose').Document} coe
 * @param {object} adhocPayer
 * @returns {{ customerName: string, description: string, orderNumber: string, customerEmail?: string, customerIdentifier: string }}
 */
function buildAdhocGoatChargeFields(payment, chargeUser, coe, adhocPayer) {
  const userIdStr = chargeUser._id ? String(chargeUser._id) : '';
  const baseDescription = payment.description || 'On-spot payment';

  if (adhocPayer?.type !== 'guest') {
    return {
      customerName: getCustomerDisplayName(chargeUser),
      description: baseDescription,
      orderNumber: payment._id.toString(),
      customerEmail: chargeUser.email || undefined,
      customerIdentifier: userIdStr,
    };
  }

  const coeId = coe._id.toString();
  const coeLabel =
    (coe.name && String(coe.name).trim()) || `Experience ${coeId.slice(-6)}`;
  const guestName = String(adhocPayer.display_name).trim();
  const guestEmail = adhocPayer.email ? String(adhocPayer.email).trim() : undefined;

  return {
    customerName: guestName,
    description: `[${coeLabel}] ${baseDescription}`.slice(0, 500),
    orderNumber: `coe-${coeId}-${payment._id}`.slice(0, 120),
    customerEmail: guestEmail || chargeUser.email || undefined,
    customerIdentifier: `coe:${coeId}`,
  };
}

/**
 * Execute GOAT charge for an existing pending Payment document.
 * @param {import('mongoose').Document} payment
 * @param {import('mongoose').Document} chargeUser - User for GOAT customer context (COE client)
 * @param {string} sourceToken - GOAT cardRef / token
 * @param {object} [savedMethod] - Optional saved method for display fallback
 * @param {import('mongoose').Document} coe - COE for guest GOAT tagging
 * @param {object} adhocPayer - Payer snapshot on the payment
 * @returns {Promise<import('mongoose').Document>}
 */
async function executeGoatChargeOnPayment(
  payment,
  chargeUser,
  sourceToken,
  savedMethod,
  coe,
  adhocPayer,
) {
  const source = goatClient.toSourceToken(sourceToken);
  const goatCustomerId = await ensureGoatCustomerId(chargeUser);
  const goatFields = buildAdhocGoatChargeFields(payment, chargeUser, coe, adhocPayer);
  const chargeRequest = {
    amount: payment.amount,
    source,
    description: goatFields.description,
    orderNumber: goatFields.orderNumber,
    customerName: goatFields.customerName,
    customer: {
      customer_id: goatCustomerId,
      identifier: goatFields.customerIdentifier,
      email: goatFields.customerEmail,
    },
  };

  let goatData;
  try {
    goatData = await goatClient.chargeWithSource(chargeRequest);
  } catch (goatErr) {
    const isTimeoutError =
      goatErr?.code === 'ECONNABORTED' || /timeout/i.test(goatErr?.message || '');
    if (isTimeoutError) {
      try {
        goatData = await goatClient.chargeWithSource(chargeRequest);
      } catch (retryErr) {
        goatErr = retryErr;
      }
    }
    if (!goatData) {
      const msg =
        goatErr.message ||
        goatErr.response?.data?.error_message ||
        goatErr.response?.data?.message ||
        'Payment failed. Please try again.';
      payment.status = 'failed';
      payment.failure_message = msg;
      payment.failed_at = new Date();
      await payment.save();
      throw new Error(msg);
    }
  }

  if (!goatClient.isChargeApproved(goatData)) {
    const msg =
      goatData.error_message || goatData.message || 'Payment was not approved';
    payment.status = 'failed';
    payment.failure_message = msg;
    payment.failed_at = new Date();
    await payment.save();
    throw new Error(msg);
  }

  const refNum = goatData.reference_number;
  payment.gp_transaction_id =
    refNum != null ? String(refNum) : String(goatData.transaction?.id || '');
  payment.status = 'completed';
  payment.completed_at = new Date();
  payment.card_brand =
    goatData.card_type || savedMethod?.card_brand || detectCardBrandFromService('');
  payment.card_last_four =
    goatData.last_4 != null
      ? String(goatData.last_4)
      : savedMethod?.card_last_four || null;
  payment.is_token_payment = true;
  payment.payment_token_id = sourceToken;
  await payment.save();
  return payment;
}

/**
 * Process admin adhoc payment.
 * @param {string} adminUserId
 * @param {object} payload
 * @param {string} [idempotencyKey]
 * @returns {Promise<import('mongoose').Document>}
 */
async function processAdhocPayment(adminUserId, payload, idempotencyKey) {
  const {
    coe_id: coeId,
    event_id: eventId,
    amount,
    description,
    charge_method: chargeMethod,
    payer_user_id: payerUserId,
    token_id: tokenId,
    card,
    save_to_payer: saveToPayer,
    adhoc_payer: adhocPayerInput,
    adhoc_note: adhocNote,
    seat_upgrade_id: seatUpgradeId,
    adhoc_kind: adhocKindInput,
  } = payload;

  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
  if (!description || !String(description).trim()) {
    throw new Error('Description is required');
  }

  const coe = await COE.findById(coeId);
  if (!coe) {
    throw new Error('Experience not found');
  }
  if (eventId && !coeHasEventId(coe, eventId)) {
    throw new Error('Event not found on this experience');
  }

  const paidSeatUpgradeService = require('./paidSeatUpgradeService');
  let resolvedAdhocKind = adhocKindInput || 'general';
  if (seatUpgradeId) {
    paidSeatUpgradeService.assertPendingUpgradeForCharge(
      coe,
      seatUpgradeId,
      amount,
      eventId
    );
    resolvedAdhocKind = 'upgrade';
  }

  const billingUserId =
    coe.client_id?._id?.toString?.() || coe.client_id?.toString?.();
  if (!billingUserId) {
    throw new Error('Experience has no primary client');
  }

  let chargeUserId = payerUserId || billingUserId;
  let adhocPayer = adhocPayerInput || { type: 'client' };

  if (adhocPayer.type === 'guest') {
    if (!adhocPayer.display_name || !String(adhocPayer.display_name).trim()) {
      throw new Error('Guest name is required');
    }
    const guestEmailRaw = adhocPayer.email ? String(adhocPayer.email).trim() : '';
    if (
      chargeMethod !== 'cash' &&
      (!guestEmailRaw || !guestEmailRaw.includes('@'))
    ) {
      throw new Error('Guest email is required');
    }
    chargeUserId = billingUserId;
    adhocPayer = {
      type: 'guest',
      display_name: String(adhocPayer.display_name).trim(),
      email: guestEmailRaw || undefined,
      phone: adhocPayer.phone ? String(adhocPayer.phone).trim() : undefined,
    };
  } else {
    assertPayerOnCoe(coe, chargeUserId);
    const isPrimary = chargeUserId === billingUserId;
    const payerUser = await User.findById(chargeUserId);
    if (!payerUser) {
      throw new Error('Payer user not found');
    }
    adhocPayer = {
      type: isPrimary ? 'client' : 'participant',
      user_id: chargeUserId,
      display_name: getCustomerDisplayName(payerUser),
      email: payerUser.email || undefined,
      phone: payerUser.phone || undefined,
    };
  }

  if (idempotencyKey) {
    const existing = await Payment.findOne({ idempotency_key: idempotencyKey });
    if (existing) {
      if (existing.status === 'completed') {
        return existing;
      }
      throw new Error('Duplicate request is still processing or failed');
    }
  }

  const payment = new Payment({
    coe_id: coeId,
    event_id: eventId || undefined,
    user_id: billingUserId,
    amount: Math.round((Number(amount) + Number.EPSILON) * 100) / 100,
    currency: coe.currency || PAYMENT_CONFIG.currency,
    payment_type: 'adhoc',
    status: 'pending',
    description: String(description).trim(),
    created_by_admin_id: adminUserId,
    adhoc_payer: adhocPayer,
    adhoc_note: adhocNote ? String(adhocNote).trim() : undefined,
    seat_upgrade_id: seatUpgradeId || undefined,
    adhoc_kind: resolvedAdhocKind,
    idempotency_key: idempotencyKey || undefined,
  });
  await payment.save();

  const chargeUser = await User.findById(chargeUserId);
  if (!chargeUser) {
    payment.status = 'failed';
    payment.failure_message = 'Charge user not found';
    payment.failed_at = new Date();
    await payment.save();
    throw new Error('Charge user not found');
  }

  assertAdhocReceiptEmailAvailable(
    adhocPayer,
    chargeUser,
    chargeMethod !== 'cash' && isReceiptEmailEnabled()
  );

  try {
    if (chargeMethod === 'cash') {
      if (!payerUserId) {
        throw new Error('payer_user_id is required for cash payments');
      }
      payment.payment_channel = 'cash';
      payment.recorded_by_admin_id = adminUserId;
      payment.finance_sync_status = 'pending';
      payment.cash_note = adhocNote ? String(adhocNote).trim() : undefined;
      payment.status = 'completed';
      payment.completed_at = new Date();
      await payment.save();
    } else if (chargeMethod === 'saved_card') {
      if (!tokenId) {
        throw new Error('token_id is required for saved card charges');
      }
      assertPayerOnCoe(coe, chargeUserId);
      const savedMethod = chargeUser.saved_payment_methods?.find(
        (m) => m.token_id === tokenId
      );
      if (!savedMethod) {
        throw new Error('Payment method not found or unauthorized');
      }
      await executeGoatChargeOnPayment(
        payment,
        chargeUser,
        tokenId,
        savedMethod,
        coe,
        adhocPayer,
      );
      savedMethod.last_used_at = new Date();
      await chargeUser.save();
    } else if (chargeMethod === 'one_time_card') {
      if (!card?.card || !card?.expiry_month || !card?.expiry_year) {
        throw new Error('Card number and expiry are required');
      }
      const expiryMonth = parseInt(String(card.expiry_month), 10);
      let expiryYear = parseInt(String(card.expiry_year), 10);
      if (expiryYear < 100) {
        expiryYear += 2000;
      }
      const { cardRef } = await goatClient.createSavedCardFromCardNumber({
        card: String(card.card).replace(/\s/g, ''),
        expiry_month: expiryMonth,
        expiry_year: expiryYear,
      });
      const cardRefStr = String(cardRef);
      const lastFour = String(card.card).replace(/\D/g, '').slice(-4);
      const brand = detectCardBrandFromService(String(card.card));

      if (saveToPayer && adhocPayer.type !== 'guest') {
        const expiryMonthStr = String(card.expiry_month).padStart(2, '0').slice(-2);
        const expiryYearStr =
          String(card.expiry_year).length === 2
            ? String(card.expiry_year)
            : String(expiryYear).slice(-2);
        const exists = chargeUser.saved_payment_methods?.some(
          (m) => m.token_id === cardRefStr
        );
        if (!exists) {
          if ((chargeUser.saved_payment_methods || []).length >= 5) {
            throw new Error(
              'Maximum of 5 payment methods allowed. Cannot save card to payer wallet.'
            );
          }
          chargeUser.saved_payment_methods = chargeUser.saved_payment_methods || [];
          chargeUser.saved_payment_methods.push({
            token_id: cardRefStr,
            card_brand: brand,
            card_last_four: lastFour,
            expiry_month: expiryMonthStr,
            expiry_year: expiryYearStr,
            is_default: chargeUser.saved_payment_methods.length === 0,
            nickname: `${brand} •••• ${lastFour}`,
            created_at: new Date(),
            update_history: [],
          });
          await chargeUser.save();
        }
      }

      await executeGoatChargeOnPayment(
        payment,
        chargeUser,
        cardRefStr,
        {
          card_brand: brand,
          card_last_four: lastFour,
        },
        coe,
        adhocPayer,
      );
    } else {
      throw new Error('Invalid charge_method');
    }

    await paymentService.recordAdhocPaymentCompletion(coeId, payment);

    if (seatUpgradeId) {
      try {
        await paidSeatUpgradeService.applyPaidSeatUpgradeAfterPayment(
          coeId,
          seatUpgradeId,
          payment
        );
      } catch (applyErr) {
        console.error('[AdhocPayment] paid seat upgrade apply failed:', {
          payment_id: payment._id,
          upgrade_id: seatUpgradeId,
          error: applyErr.message,
        });
        throw new Error(
          `Payment succeeded but upgrade apply failed: ${applyErr.message}`
        );
      }
    }

    const billingUser = await User.findById(billingUserId);
    const paymentForEmail = await Payment.findById(payment._id).lean();
    const receiptRecipientEmail = getAdhocReceiptRecipientEmail(
      paymentForEmail || payment,
      chargeUser,
    );

    setImmediate(() => {
      (async () => {
        try {
          if (!isReceiptEmailEnabled()) {
            console.warn('[AdhocPayment] receipt email skipped — set SEND_PAYMENT_RECEIPT_EMAIL=true', {
              payment_id: payment._id,
              guest_email: receiptRecipientEmail || null,
            });
            return;
          }
          if (!receiptRecipientEmail) {
            console.warn('[AdhocPayment] receipt email skipped: no recipient email on payment', {
              payment_id: payment._id,
              adhoc_payer_type: paymentForEmail?.adhoc_payer?.type,
            });
            return;
          }
          await sendPaymentReceiptEmail({
            user: billingUser || chargeUser,
            payment: paymentForEmail || payment,
            coeName: coe.name,
            chargeUser,
            recipientEmail: receiptRecipientEmail,
          });
        } catch (err) {
          console.error('[AdhocPayment] receipt email error:', {
            payment_id: payment._id,
            to: receiptRecipientEmail,
            error: err?.message || err,
          });
        }
      })();
    });

    console.log('[AdhocPayment] completed:', {
      payment_id: payment._id,
      coe_id: coeId,
      event_id: eventId,
      admin_id: adminUserId,
      amount: payment.amount,
      timestamp: new Date().toISOString(),
    });

    return payment;
  } catch (err) {
    if (payment.status === 'pending') {
      payment.status = 'failed';
      payment.failure_message = err.message;
      payment.failed_at = new Date();
      await payment.save();
    }
    throw err;
  }
}

/**
 * Serialize payment for API (mask guest phone for non-admin callers).
 * @param {import('mongoose').Document|object} payment
 * @param {boolean} isAdmin
 * @returns {object}
 */
const { withAdhocPaymentSummary } = require('../utils/adhocPaymentDisplay');

function serializePaymentForApi(payment, isAdmin = false) {
  const p =
    typeof payment.toObject === 'function' ? payment.toObject() : { ...payment };
  if (!isAdmin && p.adhoc_payer?.phone) {
    p.adhoc_payer = { ...p.adhoc_payer, phone: undefined };
  }
  return withAdhocPaymentSummary(p);
}

module.exports = {
  getAdhocPaymentOptions,
  processAdhocPayment,
  serializePaymentForApi,
  getCoePayerUserIds,
};
