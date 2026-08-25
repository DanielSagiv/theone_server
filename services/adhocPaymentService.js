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
const {
  computeOnSpotChargeTotalWithFees,
} = require('../utils/eventLineFeeTotal');

const PAYMENT_CONFIG = {
  currency: process.env.PAYMENT_CURRENCY || 'USD',
};

const ADHOC_SIGNATURE_SVG_MAX = 200000;

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
function finiteUsdOrNull(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Booked min-spend / buy-in for on-spot (same number Event Details shows as negotiated).
 * Never use Event catalog fields (venue_min_spend_usd / negotiated_min_spend_usd).
 * @param {object|null|undefined} row
 * @returns {number|null}
 */
function bookedMinSpendUsd(row) {
  return finiteUsdOrNull(row?.event_price) ?? finiteUsdOrNull(row?.base_price);
}

/**
 * Return the effective min-spend USD for a given event on a COE.
 * Cap is booked event_price (else base_price). Catalog is strikethrough-only.
 * @param {object} coe - lean or mongoose COE doc
 * @param {string} eventId
 * @returns {{ venue_usd: number|null, negotiated_usd: number|null, effective_usd: number|null }}
 */
function resolveMinSpendForEvent(coe, eventId) {
  const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
  const eid = String(eventId);
  for (const row of seats) {
    const rowEid =
      row?.event_id?._id?.toString?.() || row?.event_id?.toString?.() || '';
    if (rowEid !== eid) continue;

    const catalog =
      finiteUsdOrNull(row.venue_catalog_price) ??
      finiteUsdOrNull(row.simple_joint_original_price) ??
      finiteUsdOrNull(row.venue_min_spend_usd);

    const booked = bookedMinSpendUsd(row);
    const effective = booked ?? catalog;

    return {
      venue_usd: catalog,
      negotiated_usd: effective,
      effective_usd: effective,
    };
  }
  return { venue_usd: null, negotiated_usd: null, effective_usd: null };
}

/**
 * Compute how much of the min-spend balance has been used for an event.
 * @param {object} coe - lean or mongoose COE doc
 * @param {string} eventId
 * @returns {number}
 */
function getMinSpendUsed(coe, eventId) {
  const tracker = Array.isArray(coe.on_spot_min_spend_used) ? coe.on_spot_min_spend_used : [];
  const eid = String(eventId);
  for (const row of tracker) {
    const rowEid =
      row?.event_id?._id?.toString?.() || row?.event_id?.toString?.() || '';
    if (rowEid === eid) return Number(row.absorbed) || 0;
  }
  return 0;
}

/**
 * Compute the split of a base amount between min-spend absorption and card charge.
 * Guest payer charges never use min spend.
 * @param {number} remaining - remaining min-spend balance
 * @param {number} baseAmount - admin-entered base price
 * @returns {{ absorbed: number, cardBase: number }}
 */
function computeMinSpendSplit(remaining, baseAmount) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const absorbed = r2(Math.min(Math.max(remaining, 0), baseAmount));
  const cardBase = r2(Math.max(0, baseAmount - absorbed));
  return { absorbed, cardBase };
}

/**
 * Validate and normalize payer signature for an on-spot charge.
 * @param {object} input
 * @param {string} [fallbackName]
 * @returns {{ svg: string, initials: string, signed_name?: string, signed_at: Date }}
 */
function normalizeAdhocSignature(input, fallbackName) {
  if (!input || typeof input !== 'object') {
    throw new Error('Payer signature is required');
  }
  const svg = typeof input.svg === 'string' ? input.svg.trim() : '';
  if (!svg) {
    throw new Error('Payer signature is required');
  }
  if (svg.length > ADHOC_SIGNATURE_SVG_MAX) {
    throw new Error('Payer signature is too large');
  }
  const svgLower = svg.toLowerCase();
  if (!svgLower.includes('<svg') || !svgLower.includes('<path')) {
    throw new Error('Payer signature is invalid');
  }
  if (svgLower.includes('<script') || svgLower.includes('javascript:')) {
    throw new Error('Payer signature is invalid');
  }
  const initialsRaw = typeof input.initials === 'string' ? input.initials.trim() : '';
  const initials = initialsRaw.replace(/[^A-Za-z]/g, '').slice(0, 8).toUpperCase();
  if (!initials) {
    throw new Error('Payer initials are required');
  }
  const signedNameRaw =
    (typeof input.signed_name === 'string' && input.signed_name.trim()) ||
    (typeof fallbackName === 'string' && fallbackName.trim()) ||
    '';
  return {
    svg,
    initials,
    signed_name: signedNameRaw.slice(0, 120) || undefined,
    signed_at: new Date(),
  };
}

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
 * Lazy back-fill venue_min_spend_usd / negotiated_min_spend_usd onto the COE selected_seats row.
 * Catalog (venue_min_spend_usd) may come from Event when missing.
 * negotiated_min_spend_usd always follows booked event_price/base_price when present —
 * never Event.seats[].event_min_spend / min_spend (those freeze the cap at catalog).
 * Does not touch on_spot_min_spend_used.
 * @param {string} coeId
 * @param {string} eventId
 * @returns {Promise<void>}
 */
async function backfillMinSpendOnCoe(coeId, eventId) {
  try {
    const coeDoc = await COE.findById(coeId);
    if (!coeDoc) return;
    const eid = String(eventId);
    const seats = Array.isArray(coeDoc.selected_seats) ? coeDoc.selected_seats : [];
    let changed = false;
    for (const row of seats) {
      const rowEid =
        row?.event_id?._id?.toString?.() || row?.event_id?.toString?.() || '';
      if (rowEid !== eid) continue;

      const bookedFromSeat = bookedMinSpendUsd(row);

      if (row.venue_min_spend_usd == null) {
        const eventDoc = await Event.findById(eventId)
          .select('seats')
          .lean();
        if (!eventDoc) break;
        const seatId = row.seat_id?.toString?.() || '';
        const evSeat = (eventDoc.seats || []).find(
          (s) => (s._id?.toString?.() || '') === seatId,
        );
        if (!evSeat) break;
        const venue = finiteUsdOrNull(evSeat.min_spend);
        row.venue_min_spend_usd = venue;
        changed = true;
      }

      if (
        bookedFromSeat != null &&
        finiteUsdOrNull(row.negotiated_min_spend_usd) !== bookedFromSeat
      ) {
        row.negotiated_min_spend_usd = bookedFromSeat;
        changed = true;
      }
      break;
    }
    if (changed) {
      await coeDoc.save();
    }
  } catch (err) {
    console.warn('[AdhocPayment] min-spend back-fill failed:', err?.message);
  }
}

/**
 * Load admin adhoc payment screen options for a COE.
 * @param {string} coeId
 * @param {string} [eventId]
 * @returns {Promise<object>}
 */
async function getAdhocPaymentOptions(coeId, eventId) {
  // Lazy back-fill min-spend values from Event catalog onto COE selected_seats.
  if (eventId) {
    await backfillMinSpendOnCoe(coeId, eventId);
  }

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

  /** Fee rates for on-spot preview (mobile enters base; server charges base+fees). */
  let onSpotFeeContext = null;
  /** @type {string|null} */
  let locationId = null;
  /** @type {string|null} */
  let locationName = null;
  if (eventId) {
    try {
      const { loadEventLocation } = require('../utils/eventLineFeeTotal');
      const { resolveThe1FeePercentForSeat } = require('./coeService');
      const location = await loadEventLocation(eventId);
      if (location) {
        locationId =
          location._id?.toString?.() ||
          (location.id != null ? String(location.id) : null);
        locationName =
          typeof location.name === 'string' && location.name.trim()
            ? location.name.trim()
            : null;
      }
      const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
      const eid = String(eventId);
      let the1Pct = resolveThe1FeePercentForSeat({});
      for (const row of seats) {
        const rowEid =
          row?.event_id?._id?.toString?.() ||
          row?.event_id?.toString?.() ||
          '';
        if (rowEid === eid) {
          the1Pct = resolveThe1FeePercentForSeat(row);
          break;
        }
      }
      onSpotFeeContext = {
        the1_fee_percent: the1Pct,
        processing_fee_percent: 3,
        admin_fee_percent: location?.adminFeePercent ?? null,
        gratuity_percent: location?.gratuityPercent ?? null,
        sales_tax_percent: location?.salesTaxPercent ?? null,
      };
    } catch (feeCtxErr) {
      console.warn('[AdhocPayment] on_spot fee context unavailable:', feeCtxErr?.message);
      onSpotFeeContext = null;
    }
  }

  // Build min-spend balance info for this event.
  let minSpendInfo = null;
  if (eventId) {
    const msResolved = resolveMinSpendForEvent(coe, eventId);
    if (msResolved.effective_usd != null) {
      const used = getMinSpendUsed(coe, eventId);
      const remaining = Math.max(0, msResolved.effective_usd - used);
      minSpendInfo = {
        venue_usd: msResolved.venue_usd,
        negotiated_usd: msResolved.negotiated_usd,
        effective_usd: msResolved.effective_usd,
        used_usd: used,
        remaining_usd: Math.round(remaining * 100) / 100,
      };
    }
  }

  return {
    coe: {
      id: coe._id.toString(),
      name: coe.name,
      currency: coe.currency || PAYMENT_CONFIG.currency,
      client_id: coe.client_id?._id?.toString?.() || coe.client_id?.toString?.(),
      adhoc_collected_total: coe.adhoc_collected_total || 0,
      is_the1_event: coe.is_the1_event === true,
      original_request_data: {
        is_the1_event: coe.original_request_data?.is_the1_event === true,
      },
    },
    payers,
    events: eventLines,
    selected_event: selectedEvent,
    location_id: locationId,
    location_name: locationName,
    on_spot_fee_context: onSpotFeeContext,
    min_spend: minSpendInfo,
    event_charges: await listEventCardCharges(coe._id, eventId),
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
    adhoc_signature: adhocSignatureInput,
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
  /** Base amount for on_spot_charges line (fee-exclusive). Charge amount may include fees. */
  let onSpotBaseAmount = null;
  let chargeAmount = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;

  /** Min-spend split result (only for non-guest on-spot charges). */
  let minSpendAbsorbed = 0;
  let cardChargedBase = 0;
  /** Fee snapshot for new on-spot card charges (null for cash/min-spend-only). */
  let adhocFeeBreakdown = null;
  /** When cardBase = 0, this charge is fully covered by min spend — no GOAT call. */
  let isMinSpendOnly = false;

  if (seatUpgradeId) {
    paidSeatUpgradeService.assertPendingUpgradeForCharge(
      coe,
      seatUpgradeId,
      amount,
      eventId
    );
    resolvedAdhocKind = 'upgrade';
  } else if (eventId) {
    // On-spot: amount is base entered by admin.
    // For non-guest payers: apply min-spend deduction first; only charge card for the excess.
    const isGuestPayer =
      adhocPayerInput?.type === 'guest' ||
      (adhocPayerInput == null && false);
    if (!isGuestPayer) {
      const msUsed = getMinSpendUsed(coe, eventId);
      const msResolved = resolveMinSpendForEvent(coe, eventId);
      const remaining = msResolved.effective_usd != null
        ? Math.max(0, msResolved.effective_usd - msUsed)
        : 0;
      const split = computeMinSpendSplit(remaining, Number(amount));
      minSpendAbsorbed = split.absorbed;
      cardChargedBase = split.cardBase;
    } else {
      // Guest payer — no min-spend deduction.
      cardChargedBase = Number(amount);
    }

    if (cardChargedBase <= 0) {
      // Fully absorbed by min spend — no GOAT charge.
      isMinSpendOnly = true;
      onSpotBaseAmount = Number(amount);
      chargeAmount = 0;
    } else {
      // Card charge on the excess only.
      const priced = await computeOnSpotChargeTotalWithFees(coe, eventId, cardChargedBase);
      if (!(priced.total > 0)) {
        throw new Error('Amount must be greater than zero');
      }
      onSpotBaseAmount = Number(amount);
      chargeAmount = priced.total;
      adhocFeeBreakdown = {
        card_base: Number(priced.base) || 0,
        sales_tax: Number(priced.salesTax) || 0,
        gratuity: Number(priced.gratuity) || 0,
        venue_admin: Number(priced.venueAdmin) || 0,
        the1_fee: Number(priced.the1Fee) || 0,
        processing_fee: Number(priced.processingFee) || 0,
        total_with_fees: Number(priced.total) || 0,
      };
    }
    resolvedAdhocKind = resolvedAdhocKind === 'upgrade' ? 'general' : resolvedAdhocKind;
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

  const adhocSignature = normalizeAdhocSignature(
    adhocSignatureInput,
    adhocPayer.display_name
  );

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
    amount: chargeAmount,
    currency: coe.currency || PAYMENT_CONFIG.currency,
    payment_type: 'adhoc',
    status: 'pending',
    description: String(description).trim(),
    created_by_admin_id: adminUserId,
    adhoc_payer: adhocPayer,
    adhoc_note: adhocNote ? String(adhocNote).trim() : undefined,
    adhoc_signature: adhocSignature,
    seat_upgrade_id: seatUpgradeId || undefined,
    adhoc_kind: resolvedAdhocKind,
    idempotency_key: idempotencyKey || undefined,
    min_spend_absorbed: minSpendAbsorbed,
    card_charged_base: cardChargedBase,
    adhoc_fee_breakdown: adhocFeeBreakdown || undefined,
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
    if (isMinSpendOnly) {
      // Fully absorbed by min spend: record as a completed zero-charge (no GOAT call).
      payment.payment_channel = 'min_spend';
      payment.recorded_by_admin_id = adminUserId;
      payment.finance_sync_status = 'skipped';
      payment.status = 'completed';
      payment.completed_at = new Date();
      // Give a fake gp_transaction_id so it shows up in listEventCardCharges.
      payment.gp_transaction_id = `min_spend_${payment._id}`;
      await payment.save();
    } else if (chargeMethod === 'cash') {
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

    const isUpgradeCharge =
      !!seatUpgradeId || resolvedAdhocKind === 'upgrade';
    if (!isUpgradeCharge && eventId) {
      try {
        const coeForLine = await COE.findById(coeId);
        if (coeForLine) {
          const payerSnap = payment.adhoc_payer
            ? {
                type: payment.adhoc_payer.type,
                user_id: payment.adhoc_payer.user_id || undefined,
                display_name: payment.adhoc_payer.display_name || undefined,
                email: payment.adhoc_payer.email || undefined,
                phone: payment.adhoc_payer.phone || undefined,
              }
            : undefined;
          coeForLine.on_spot_charges = coeForLine.on_spot_charges || [];
          coeForLine.on_spot_charges.push({
            event_id: eventId,
            payment_id: payment._id,
            description: String(payment.description || '').trim(),
            amount:
              onSpotBaseAmount != null
                ? onSpotBaseAmount
                : Number(payment.amount) || 0,
            min_spend_absorbed: minSpendAbsorbed,
            card_charged_base: cardChargedBase,
            adhoc_payer: payerSnap,
            created_by: adminUserId,
            created_at: new Date(),
          });

          // Update the per-event min-spend balance tracker.
          if (minSpendAbsorbed > 0) {
            coeForLine.on_spot_min_spend_used = coeForLine.on_spot_min_spend_used || [];
            const eid = String(eventId);
            const trackerRow = coeForLine.on_spot_min_spend_used.find(
              (r) =>
                (r?.event_id?._id?.toString?.() || r?.event_id?.toString?.() || '') === eid,
            );
            if (trackerRow) {
              trackerRow.absorbed = Math.round(
                ((Number(trackerRow.absorbed) || 0) + minSpendAbsorbed) * 100,
              ) / 100;
            } else {
              coeForLine.on_spot_min_spend_used.push({
                event_id: eventId,
                absorbed: minSpendAbsorbed,
              });
            }
          }

          await coeForLine.save();
        }
      } catch (lineErr) {
        console.error('[AdhocPayment] on_spot_charges append failed:', {
          payment_id: payment._id,
          coe_id: coeId,
          error: lineErr?.message || lineErr,
        });
      }
    }

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
const { withAdhocPaymentSummary, getAdhocPayerDisplayName } = require('../utils/adhocPaymentDisplay');

function serializePaymentForApi(payment, isAdmin = false) {
  const p =
    typeof payment.toObject === 'function' ? payment.toObject() : { ...payment };
  if (!isAdmin && p.adhoc_payer?.phone) {
    p.adhoc_payer = { ...p.adhoc_payer, phone: undefined };
  }
  return withAdhocPaymentSummary(p);
}

/**
 * Parse GOAT integer reference from Payment.gp_transaction_id.
 * @param {object} payment
 * @returns {number}
 */
function parseAdhocGoatReference(payment) {
  const refRaw = payment?.gp_transaction_id;
  const referenceNumber = parseInt(String(refRaw || '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(referenceNumber) || referenceNumber < 1) {
    throw new Error('Invalid gateway transaction reference for undo');
  }
  return referenceNumber;
}

/**
 * Map GOAT undo response to stored goat_undo_type.
 * @param {object} goatBody
 * @param {'void'|'reversal'} mode
 * @returns {'void'|'refund'|'adjust'}
 */
function mapGoatUndoType(goatBody, mode) {
  const raw = goatBody?.type != null ? String(goatBody.type).toLowerCase() : '';
  if (raw === 'void' || raw === 'refund' || raw === 'adjust') {
    return raw;
  }
  return mode === 'void' ? 'void' : 'refund';
}

/**
 * Card on-spot charges for an event (completed + already undone) for admin UI rows.
 * @param {import('mongoose').Types.ObjectId|string} coeId
 * @param {string} [eventId]
 * @returns {Promise<object[]>}
 */
async function listEventCardCharges(coeId, eventId) {
  if (!eventId) return [];
  const payments = await Payment.find({
    coe_id: coeId,
    event_id: eventId,
    payment_type: 'adhoc',
    // Include card and min_spend channels; exclude cash.
    payment_channel: { $in: ['card', 'min_spend'] },
    status: { $in: ['completed', 'cancelled', 'refunded'] },
  })
    .sort({ createdAt: -1 })
    .lean();

  return payments
    .filter((p) => p.gp_transaction_id)
    .map((p) => ({
      payment_id: p._id.toString(),
      display_name: getAdhocPayerDisplayName(p),
      adhoc_payer_type: p.adhoc_payer?.type || null,
      description: String(p.description || '').trim() || null,
      amount: Number(p.amount) || 0,
      min_spend_absorbed: Number(p.min_spend_absorbed) || 0,
      card_charged_base: Number(p.card_charged_base) || 0,
      adhoc_fee_breakdown: p.adhoc_fee_breakdown || null,
      status: p.status,
      goat_undo_type: p.goat_undo_type || null,
      can_undo: p.status === 'completed',
      charged_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      operation_at:
        p.status !== 'completed' && p.updatedAt
          ? new Date(p.updatedAt).toISOString()
          : null,
    }));
}

/**
 * Admin GOAT void or full reversal of a completed adhoc card charge.
 * Does not change COE deposit/full payment_status.
 * @param {string} adminUserId
 * @param {string} paymentId
 * @param {{ mode: 'void'|'reversal', coeId?: string }} opts
 * @returns {Promise<object>} serialized payment
 */
async function undoAdhocPayment(adminUserId, paymentId, opts) {
  const mode = opts?.mode;
  if (mode !== 'void' && mode !== 'reversal') {
    throw new Error('Undo mode must be void or reversal');
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }
  if (payment.payment_type !== 'adhoc') {
    throw new Error('Only on-spot payments can be voided or reversed here');
  }
  if (opts?.coeId && String(payment.coe_id) !== String(opts.coeId)) {
    throw new Error('Payment does not belong to this experience');
  }
  if (payment.status !== 'completed') {
    throw new Error(`Cannot undo payment in status: ${payment.status}`);
  }
  if (payment.payment_channel === 'cash') {
    throw new Error('Cash payments cannot be voided or reversed through GOAT');
  }

  // Min-spend-only payments have no GOAT charge to reverse — just mark cancelled.
  if (payment.payment_channel === 'min_spend') {
    payment.status = 'cancelled';
    payment.goat_undo_type = 'void';
    payment.refund_reason = mode === 'void' ? 'On-spot void' : 'On-spot reversal';
    await payment.save();

    const coeId = payment.coe_id?.toString?.() || String(payment.coe_id || '');
    if (coeId) {
      try {
        const coeLine = await COE.findById(coeId);
        if (coeLine) {
          let changed = false;
          if (coeLine.on_spot_charges?.length) {
            const pid = String(payment._id);
            const before = coeLine.on_spot_charges.length;
            coeLine.on_spot_charges = coeLine.on_spot_charges.filter(
              (row) => String(row.payment_id) !== pid,
            );
            if (coeLine.on_spot_charges.length !== before) changed = true;
          }
          const absorbedToRestore = Number(payment.min_spend_absorbed) || 0;
          const undoneEventId =
            payment.event_id?._id?.toString?.() || payment.event_id?.toString?.() || '';
          if (absorbedToRestore > 0 && undoneEventId) {
            coeLine.on_spot_min_spend_used = coeLine.on_spot_min_spend_used || [];
            const trackerRow = coeLine.on_spot_min_spend_used.find(
              (r) =>
                (r?.event_id?._id?.toString?.() || r?.event_id?.toString?.() || '') ===
                undoneEventId,
            );
            if (trackerRow) {
              trackerRow.absorbed = Math.round(
                Math.max(0, (Number(trackerRow.absorbed) || 0) - absorbedToRestore) * 100,
              ) / 100;
              changed = true;
            }
          }
          if (changed) await coeLine.save();
        }
      } catch (lineErr) {
        console.error('[AdhocPayment] min-spend-only undo COE update failed:', {
          payment_id: payment._id,
          error: lineErr.message,
        });
      }
    }

    console.log('[AdhocPayment] min-spend-only undo completed', {
      payment_id: paymentId,
      mode,
      admin_id: adminUserId,
      timestamp: new Date().toISOString(),
    });
    return serializePaymentForApi(payment, true);
  }

  const referenceNumber = parseAdhocGoatReference(payment);
  const description =
    mode === 'void' ? 'On-spot void' : 'On-spot reversal';

  let goatBody;
  try {
    goatBody =
      mode === 'void'
        ? await goatClient.voidTransaction({
            reference_number: referenceNumber,
            description,
          })
        : await goatClient.reverseTransaction({
            reference_number: referenceNumber,
            description,
          });
  } catch (goatErr) {
    console.error('[AdhocPayment] GOAT undo failed', {
      payment_id: paymentId,
      mode,
      admin_id: adminUserId,
      error: goatErr.message,
      timestamp: new Date().toISOString(),
    });
    throw goatErr;
  }

  const undoType = mapGoatUndoType(goatBody, mode);
  payment.goat_undo_type = undoType;
  payment.refund_reason = description;
  if (undoType === 'void') {
    payment.status = 'cancelled';
  } else {
    payment.status = 'refunded';
    payment.refund_amount = Number(payment.amount) || 0;
    payment.refunded_at = new Date();
    if (goatBody?.reference_number != null) {
      payment.refund_transaction_id = String(goatBody.reference_number);
    }
  }
  await payment.save();

  const coeId = payment.coe_id?.toString?.() || String(payment.coe_id || '');
  if (coeId) {
    try {
      const paidSeatUpgradeService = require('./paidSeatUpgradeService');
      await paidSeatUpgradeService.revertPaidSeatUpgradeAfterUndo(coeId, payment);
    } catch (revertErr) {
      console.error('[AdhocPayment] seat upgrade revert failed after GOAT undo:', {
        payment_id: payment._id,
        error: revertErr.message,
      });
      throw new Error(
        `GOAT undo succeeded but seat revert failed: ${revertErr.message}`,
      );
    }

    try {
      const coeLine = await COE.findById(coeId);
      if (coeLine) {
        let changed = false;

        // Remove the on_spot_charges line.
        if (coeLine.on_spot_charges?.length) {
          const pid = String(payment._id);
          const before = coeLine.on_spot_charges.length;
          coeLine.on_spot_charges = coeLine.on_spot_charges.filter(
            (row) => String(row.payment_id) !== pid,
          );
          if (coeLine.on_spot_charges.length !== before) {
            changed = true;
          }
        }

        // Restore any min-spend balance that was absorbed by this payment.
        const absorbedToRestore = Number(payment.min_spend_absorbed) || 0;
        const undoneEventId =
          payment.event_id?._id?.toString?.() || payment.event_id?.toString?.() || '';
        if (absorbedToRestore > 0 && undoneEventId) {
          coeLine.on_spot_min_spend_used = coeLine.on_spot_min_spend_used || [];
          const trackerRow = coeLine.on_spot_min_spend_used.find(
            (r) =>
              (r?.event_id?._id?.toString?.() || r?.event_id?.toString?.() || '') ===
              undoneEventId,
          );
          if (trackerRow) {
            trackerRow.absorbed = Math.round(
              Math.max(0, (Number(trackerRow.absorbed) || 0) - absorbedToRestore) * 100,
            ) / 100;
            changed = true;
          }
        }

        if (changed) {
          await coeLine.save();
        }
      }
    } catch (lineErr) {
      console.error('[AdhocPayment] on_spot_charges remove / min-spend restore failed:', {
        payment_id: payment._id,
        error: lineErr.message,
      });
    }

    await paymentService.recordAdhocPaymentCompletion(coeId, payment);
  }

  console.log('[AdhocPayment] undo completed', {
    payment_id: paymentId,
    mode,
    goat_undo_type: undoType,
    admin_id: adminUserId,
    timestamp: new Date().toISOString(),
  });

  return serializePaymentForApi(payment, true);
}

module.exports = {
  getAdhocPaymentOptions,
  processAdhocPayment,
  undoAdhocPayment,
  serializePaymentForApi,
  getCoePayerUserIds,
  resolveMinSpendForEvent,
  getMinSpendUsed,
  computeMinSpendSplit,
};
