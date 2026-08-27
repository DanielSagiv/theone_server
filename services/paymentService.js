const crypto = require('crypto');
const Payment = require('../models/Payment');
const COE = require('../models/COE');
const User = require('../models/User');
const Event = require('../models/Event');
const { getCoeTaxRate, ceilCurrencyToWholeDollar } = require('./coeService');
const goatClient = require('./goatClient');
const { sendPaymentReceiptEmail } = require('./paymentReceiptEmail');

/**
 * Payment Service - GOAT Payment Gateway integration
 * @description Orchestrates COE payments, refunds, tokenized cards, and webhooks. Gateway transaction id is stored in `gp_transaction_id` (legacy field name).
 */

/**
 * Seat row is part of a joint / shared-table allocation (multi-client flow).
 * @param {object|undefined|null} s
 * @returns {boolean}
 */
function isJointAllocationSeat(s) {
  if (!s) return false;
  if (s.is_joint_allocation === true) return true;
  const gid = s.joint_event_group_id;
  return gid != null && String(gid).trim() !== '';
}

/**
 * Seat row whose full line pre-tax amount counts toward initial deposit (joint allocation or simpleJoint).
 * @param {object|undefined|null} s
 * @returns {boolean}
 */
function isFullDepositSeatRow(s) {
  if (!s) return false;
  if (s.is_simple_joint === true || s.is_simple_joint === 'true') return true;
  return isJointAllocationSeat(s);
}

/**
 * Initial deposit due: 100% of joint/simpleJoint line pre-tax + deposit_percent% of other seat pre-tax;
 * then tax (and proportional fees) matching the COE breakdown.
 * @param {object} coe - COE plain object or mongoose doc
 * @returns {{ subtotalPreTax: number, tax: number, fees: number, total: number, usesSeatSplit: boolean }}
 */
function computeInitialDepositPricing(coe) {
  if (!coe) {
    return { subtotalPreTax: 0, tax: 0, fees: 0, total: 0, usesSeatSplit: false };
  }
  const depositPercent = coe.deposit_percent != null ? Number(coe.deposit_percent) : 20;
  const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
  const jointRows = seats.filter((s) => isFullDepositSeatRow(s));
  const nonJointRows = seats.filter((s) => s && !isFullDepositSeatRow(s));
  const usesSeatSplit =
    seats.length > 0 && (jointRows.length > 0 || nonJointRows.length > 0);

  let subtotalPreTax;
  if (usesSeatSplit) {
    const jointPart = jointRows.reduce(
      (sum, r) => sum + (Number(r.event_price) || Number(r.base_price) || 0),
      0,
    );
    const nonJointSubtotal = nonJointRows.reduce(
      (sum, r) => sum + (Number(r.event_price) || Number(r.base_price) || 0),
      0,
    );
    const nonJointDeposit = nonJointSubtotal * (depositPercent / 100);
    subtotalPreTax = jointPart + nonJointDeposit;
  } else {
    const subtotalCoe = Number(coe.subtotal) || 0;
    if (subtotalCoe > 0) {
      subtotalPreTax = subtotalCoe * (depositPercent / 100);
    } else {
      subtotalPreTax = (Number(coe.total) || 0) * (depositPercent / 100);
    }
  }

  /** Prefer stored sales-tax-to-subtotal ratio (location-based THE1 pricing); else env COE_TAX_RATE. */
  const subtotalCoe = Number(coe.subtotal) || 0;
  const taxField = Number(coe.taxes) || 0;
  const effectiveRate =
    subtotalCoe > 0 && taxField >= 0 ? taxField / subtotalCoe : getCoeTaxRate();
  const tax = Math.round(subtotalPreTax * effectiveRate * 100) / 100;

  let feesAlloc = 0;
  if (subtotalCoe > 0 && typeof coe.fees === 'number' && coe.fees > 0) {
    feesAlloc = Math.round((coe.fees * (subtotalPreTax / subtotalCoe)) * 100) / 100;
  }

  const total = Math.round((subtotalPreTax + tax + feesAlloc) * 100) / 100;

  return {
    subtotalPreTax,
    tax,
    fees: feesAlloc,
    total: ceilCurrencyToWholeDollar(total),
    usesSeatSplit,
  };
}

const PAYMENT_CONFIG = {
  currency: process.env.PAYMENT_CURRENCY || 'USD',
};

function roundCurrency(amount) {
  return Math.round((Number(amount || 0) + Number.EPSILON) * 100) / 100;
}

function getFirstCoeDeductionContext({ user, coe, paymentType }) {
  const grossAmount = roundCurrency(coe?.total || 0);
  const supportsDualCharge = paymentType === 'deposit' || paymentType === 'full_payment';
  const isEligible =
    !!user &&
    user.role === 'client' &&
    user.first_coe_deduction_enabled === true &&
    user.first_coe_deduction_consumed !== true &&
    coe?.subscription_deduction_applied !== true &&
    (coe?.payment_status || 'unpaid') === 'unpaid' &&
    supportsDualCharge;

  const configuredAmount = Math.max(0, Number(user?.first_coe_deduction_amount || 1000));
  const deductionAmount = isEligible
    ? roundCurrency(Math.min(configuredAmount, grossAmount))
    : 0;
  const experienceNetAmount = roundCurrency(Math.max(0, grossAmount - deductionAmount));
  const subscriptionChargeAmount = deductionAmount > 0 ? deductionAmount : 0;

  return {
    isEligible: deductionAmount > 0,
    supportsDualCharge,
    grossAmount,
    configuredAmount,
    deductionAmount,
    subscriptionChargeAmount,
    experienceNetAmount,
  };
}

async function shouldTreatFirstCoeDeductionAsConsumed({ userId, isConsumedFlag }) {
  if (isConsumedFlag !== true) return false;
  const priorDualChargeSubscription = await Payment.exists({
    user_id: userId,
    payment_type: 'subscription',
    status: 'completed',
    description: { $regex: 'first-coe-deduction:' },
  });
  return !!priorDualChargeSubscription;
}

/**
 * Detect card brand from card number
 * @param {string} cardNumber - Card number
 * @returns {string} Card brand
 */
function detectCardBrand(cardNumber) {
  const firstDigit = cardNumber[0];
  const firstTwoDigits = cardNumber.substring(0, 2);
  
  if (firstDigit === '4') return 'VISA';
  if (firstTwoDigits >= '51' && firstTwoDigits <= '55') return 'MASTERCARD';
  if (firstTwoDigits === '34' || firstTwoDigits === '37') return 'AMEX';
  if (firstTwoDigits === '60' || firstTwoDigits === '65') return 'DISCOVER';
  
  return 'UNKNOWN';
}

/**
 * Create payment intent
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @param {string} paymentType - 'deposit', 'final_payment', 'full_payment', plus revision diffs ('deposit_diff', 'full_diff')
 * @param {Object} options - { saveCard: boolean, cardDetails: Object, tokenId: string }
 * @returns {Promise<Object>} Payment intent with payment_url
 */
/**
 * Validate COE payment eligibility and compute charge amounts (shared by card intent and cash recording).
 * @param {string} coeId
 * @param {string} userId - COE client user id
 * @param {string} paymentType
 * @returns {Promise<
 *   | { kind: 'coe_updated', coe_updated: true, previous_total: number, new_total: number, total_zero: boolean, unavailable_event_names: string[], message: string }
 *   | { kind: 'charge', coe: import('mongoose').Document, userId: string, paymentType: string, experienceChargeAmount: number, subscriptionChargeAmount: number, totalDueNow: number, deductionContext: object, quoteBreakdown: object, description: string }
 * >}
 */
async function prepareCoePaymentCharge(coeId, userId, paymentType) {
  let coe = await COE.findById(coeId).populate('client_id');
  if (!coe) {
    throw new Error('Experience not found');
  }

  if (coe.client_id._id.toString() !== userId.toString()) {
    throw new Error('Unauthorized: You can only pay for your own experiences');
  }

  const isRevisionDiffPayment =
    paymentType === 'deposit_diff' || paymentType === 'full_diff';

  if (!isRevisionDiffPayment) {
    if (!['approved', 'accepted_not_paid', 'pending_pay'].includes(coe.status)) {
      throw new Error(`Cannot pay for experience in status: ${coe.status}`);
    }
  } else if (coe.revision_state !== 'accepted') {
    throw new Error('Revision must be accepted before paying diff amounts');
  }

  const deadlineAt = isRevisionDiffPayment
    ? coe.revision_deadline_at
    : coe.payment_deadline_at;
  if (deadlineAt) {
    const now = new Date();
    if (deadlineAt <= now) {
      if (!isRevisionDiffPayment) {
        try {
          const coeService = require('./coeService');
          await coeService.updateCOEStatus(coeId, 'expired', null);
        } catch (deadlineErr) {
          console.error(
            '[PaymentService] Failed to update COE to expired after deadline:',
            deadlineErr.message,
          );
        }
        throw new Error('Payment window expired for this experience');
      }
      throw new Error('Revision payment window expired for this experience');
    }
  }

  if (!isRevisionDiffPayment) {
    const coeService = require('./coeService');
    const prepared = await coeService.preparePaymentForCOE(coeId);
    if (prepared && prepared.coe_updated) {
      return {
        kind: 'coe_updated',
        coe_updated: true,
        previous_total: prepared.previous_total,
        new_total: prepared.new_total,
        total_zero: prepared.new_total === 0,
        unavailable_event_names: prepared.unavailable_event_names,
        message: prepared.message,
      };
    }
  }

  if (
    !isRevisionDiffPayment &&
    (coe.status === 'approved' || coe.status === 'accepted_not_paid')
  ) {
    const coeService = require('./coeService');
    await coeService.updateCOEStatus(coeId, 'pending_pay', userId);
    coe = await COE.findById(coeId).populate('client_id');
  }

  const clientUser = !isRevisionDiffPayment
    ? await User.findById(userId).select(
        'role first_coe_deduction_enabled first_coe_deduction_consumed first_coe_deduction_amount',
      )
    : null;
  let deductionContext = !isRevisionDiffPayment
    ? getFirstCoeDeductionContext({ user: clientUser, coe, paymentType })
    : {
        isEligible: false,
        grossAmount: roundCurrency(coe.total || 0),
        deductionAmount: 0,
        subscriptionChargeAmount: 0,
        experienceNetAmount: roundCurrency(coe.total || 0),
      };
  if (!isRevisionDiffPayment && deductionContext.isEligible === false && clientUser) {
    const canRecoverLegacyConsumedFlag =
      clientUser.first_coe_deduction_enabled === true &&
      coe.subscription_deduction_applied !== true &&
      (coe.payment_status || 'unpaid') === 'unpaid';
    if (canRecoverLegacyConsumedFlag) {
      const actuallyConsumed = await shouldTreatFirstCoeDeductionAsConsumed({
        userId,
        isConsumedFlag: clientUser.first_coe_deduction_consumed === true,
      });
      if (!actuallyConsumed) {
        const overrideUser = {
          ...clientUser.toObject(),
          first_coe_deduction_consumed: false,
        };
        deductionContext = getFirstCoeDeductionContext({
          user: overrideUser,
          coe,
          paymentType,
        });
      }
    }
  }

  let amount;
  if (paymentType === 'deposit') {
    if (coe.payment_status && coe.payment_status !== 'unpaid') {
      throw new Error('Deposit already paid');
    }
    if (deductionContext.isEligible) {
      const depositPercent =
        typeof coe.deposit_percent === 'number' ? coe.deposit_percent : 20;
      amount = roundCurrency(
        deductionContext.experienceNetAmount * (depositPercent / 100),
      );
    } else {
      const pricing = computeInitialDepositPricing(coe);
      amount = pricing.total;
    }
    coe.deposit_amount = amount;
  } else if (paymentType === 'final_payment') {
    if (coe.payment_status !== 'deposit_paid') {
      throw new Error('Deposit must be paid first');
    }
    amount = coe.total - (coe.total_paid || 0);
    coe.final_amount = amount;
  } else if (paymentType === 'full_payment') {
    if (coe.payment_status && coe.payment_status !== 'unpaid') {
      throw new Error('Payment already processed');
    }
    amount = deductionContext.isEligible
      ? deductionContext.experienceNetAmount
      : coe.total;
  } else if (paymentType === 'deposit_diff') {
    if (coe.revision_state !== 'accepted') {
      throw new Error('Revision must be accepted before paying deposit diff');
    }
    if (coe.payment_status !== 'deposit_paid' && coe.payment_status !== 'paid') {
      throw new Error(
        'Deposit diff is only available for deposit_paid or paid experiences in revision',
      );
    }
    const depositPercentFrozen =
      typeof coe.revision_deposit_percent_frozen === 'number'
        ? coe.revision_deposit_percent_frozen
        : coe.deposit_percent || 20;
    const plainCap =
      typeof coe.toObject === 'function' ? coe.toObject() : { ...coe };
    plainCap.deposit_percent = depositPercentFrozen;
    const currentDepositAmount = computeInitialDepositPricing(plainCap).total;
    const paid = coe.total_paid || 0;
    amount = Math.max(0, currentDepositAmount - Math.min(paid, currentDepositAmount));
    coe.deposit_amount = amount;
    if (amount <= 0) {
      throw new Error('No deposit difference is currently due for this revision');
    }
  } else if (paymentType === 'full_diff') {
    if (coe.revision_state !== 'accepted') {
      throw new Error('Revision must be accepted before paying full diff');
    }
    amount = Math.max(0, (coe.total || 0) - (coe.total_paid || 0));
    if (amount <= 0) {
      throw new Error('No remaining amount is currently due for this revision');
    }
  } else {
    throw new Error('Invalid payment type');
  }

  if (amount <= 0) {
    throw new Error('Invalid payment amount');
  }

  const experienceChargeAmount = roundCurrency(amount);
  const subscriptionChargeAmount = roundCurrency(
    deductionContext.subscriptionChargeAmount || 0,
  );
  const totalDueNow = roundCurrency(subscriptionChargeAmount + experienceChargeAmount);
  const description = `${coe.name} - ${paymentType.replace('_', ' ')}`;
  const quoteBreakdown = {
    subscription_charge_amount: subscriptionChargeAmount,
    experience_gross_amount: roundCurrency(deductionContext.grossAmount || coe.total || 0),
    first_coe_deduction_amount: roundCurrency(deductionContext.deductionAmount || 0),
    experience_net_amount: roundCurrency(
      deductionContext.experienceNetAmount || coe.total || 0,
    ),
    deposit_amount: paymentType === 'deposit' ? experienceChargeAmount : null,
    experience_charge_amount: experienceChargeAmount,
    total_due_now: totalDueNow,
    first_coe_dual_charge_applies: deductionContext.isEligible === true,
  };

  return {
    kind: 'charge',
    coe,
    userId,
    paymentType,
    experienceChargeAmount,
    subscriptionChargeAmount,
    totalDueNow,
    deductionContext,
    quoteBreakdown,
    description,
  };
}

/**
 * Admin: record COE lifecycle payment as cash (no GOAT); same COE accounting as card.
 * @param {string} adminUserId
 * @param {string} coeId
 * @param {string} clientUserId
 * @param {string} paymentType
 * @param {{ cash_note?: string }} [options]
 * @returns {Promise<object>}
 */
async function recordCashCoePayment(
  adminUserId,
  coeId,
  clientUserId,
  paymentType,
  options = {},
) {
  const prepared = await prepareCoePaymentCharge(coeId, clientUserId, paymentType);
  if (prepared.kind === 'coe_updated') {
    return prepared;
  }

  const {
    coe,
    experienceChargeAmount,
    subscriptionChargeAmount,
    deductionContext,
    quoteBreakdown,
    description,
  } = prepared;

  if (
    deductionContext.isEligible &&
    subscriptionChargeAmount > 0
  ) {
    throw new Error('First experience subscription must be collected by card');
  }

  const payment = new Payment({
    coe_id: coeId,
    user_id: clientUserId,
    amount: experienceChargeAmount,
    currency: coe.currency || PAYMENT_CONFIG.currency,
    payment_type: paymentType,
    payment_channel: 'cash',
    recorded_by_admin_id: adminUserId,
    created_by_admin_id: adminUserId,
    cash_note: options.cash_note ? String(options.cash_note).trim().slice(0, 500) : undefined,
    finance_sync_status: 'pending',
    status: 'completed',
    description,
    completed_at: new Date(),
  });
  await payment.save();

  await updateCOEPaymentStatus(coeId, payment);

  const clientUser = await User.findById(clientUserId);
  setImmediate(() => {
    (async () => {
      try {
        await sendPaymentReceiptEmail({
          user: clientUser,
          payment,
          coeName: coe.name,
        });
      } catch (err) {
        console.error('[PaymentReceiptEmail] cash COE payment async error:', err?.message || err);
      }
    })();
  });

  console.log('[PaymentService] Cash COE payment recorded:', {
    admin_id: adminUserId,
    client_id: clientUserId,
    coe_id: coeId,
    payment_id: payment._id,
    payment_type: paymentType,
    amount: experienceChargeAmount,
    payment_channel: 'cash',
    timestamp: new Date().toISOString(),
  });

  return {
    payment_id: payment._id,
    amount: experienceChargeAmount,
    currency: coe.currency || PAYMENT_CONFIG.currency,
    status: payment.status,
    breakdown: quoteBreakdown,
  };
}

async function createPaymentIntent(coeId, userId, paymentType, options = {}) {
  try {
    const { tokenId = null } = options;

    const prepared = await prepareCoePaymentCharge(coeId, userId, paymentType);
    if (prepared.kind === 'coe_updated') {
      return prepared;
    }

    const {
      coe,
      experienceChargeAmount,
      subscriptionChargeAmount,
      totalDueNow,
      deductionContext,
      quoteBreakdown,
      description,
    } = prepared;
    const deductionMarker = `first-coe-deduction:${coeId}`;
    
    // If using saved token, charge it directly (Phase 2) – no duplicate Payment record
    if (tokenId) {
      if (deductionContext.isEligible) {
        const subscriptionDescription =
          `Required annual subscription (first experience deduction flow) [${deductionMarker}]`;
        const experienceDescription =
          `${description} (first experience deduction applied: $${roundCurrency(deductionContext.deductionAmount).toFixed(2)}) [${deductionMarker}]`;

        let chargedSubscriptionInThisRequest = false;
        let subscriptionPayment = await Payment.findOne({
          user_id: userId,
          payment_type: 'subscription',
          status: 'completed',
          description: { $regex: deductionMarker },
        }).sort({ createdAt: -1 });

        if (!subscriptionPayment) {
          subscriptionPayment = await chargeSavedCard(
            userId,
            tokenId,
            subscriptionChargeAmount,
            subscriptionDescription,
            null,
            'subscription'
          );
          chargedSubscriptionInThisRequest = true;
        }

        let experiencePayment;
        try {
          experiencePayment = await chargeSavedCard(
            userId,
            tokenId,
            experienceChargeAmount,
            experienceDescription,
            coeId,
            paymentType
          );
        } catch (experienceError) {
          if (chargedSubscriptionInThisRequest && subscriptionPayment?._id) {
            try {
              await processRefund(
                subscriptionPayment._id,
                subscriptionPayment.amount,
                `Compensation refund after experience charge failure [${deductionMarker}]`
              );
            } catch (refundError) {
              throw new Error(
                `${experienceError.message}. Subscription charge succeeded but compensation refund failed; manual review required.`
              );
            }
          }
          throw experienceError;
        }

        const now = new Date();
        const nextYear = new Date(now);
        nextYear.setFullYear(nextYear.getFullYear() + 1);

        await User.updateOne(
          { _id: userId, first_coe_deduction_consumed: false },
          {
            $set: {
              first_coe_deduction_consumed: true,
              subscription_required: false,
              subscription_paid_at: now,
              subscription_expires_at: nextYear,
            },
          }
        );

        await COE.updateOne(
          { _id: coeId, subscription_deduction_applied: { $ne: true } },
          {
            $set: {
              subscription_deduction_applied: true,
              subscription_deduction_amount: deductionContext.deductionAmount,
              subscription_deduction_note: 'First experience dual-charge deduction applied',
            },
          }
        );

        return {
          payment_id: experiencePayment._id,
          subscription_payment_id: subscriptionPayment._id,
          gp_transaction_id: experiencePayment.gp_transaction_id,
          amount: totalDueNow,
          currency: coe.currency || PAYMENT_CONFIG.currency,
          status: experiencePayment.status || 'completed',
          breakdown: quoteBreakdown,
        };
      }

      const payment = await chargeSavedCard(
        userId,
        tokenId,
        experienceChargeAmount,
        description,
        coeId,
        paymentType
      );
      return {
        payment_id: payment._id,
        gp_transaction_id: payment.gp_transaction_id,
        amount: experienceChargeAmount,
        currency: coe.currency || PAYMENT_CONFIG.currency,
        status: payment.status || 'completed',
        breakdown: quoteBreakdown,
      };
    }

    // Hosted checkout was Global Payments ECOM; GOAT integration requires a saved card (token) for COE pay.
    throw new Error(
      'Payment requires a saved card. Add a card in the app and try again.'
    );
    
  } catch (error) {
    console.error('Payment intent creation failed:', {
      coe_id: coeId,
      user_id: userId,
      payment_type: paymentType,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Process refund
 * @param {string} paymentId - Payment ID
 * @param {number} amount - Refund amount (null = full refund)
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund result
 */
async function processRefund(paymentId, amount = null, reason = '') {
  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    if (!['completed'].includes(payment.status)) {
      throw new Error(`Cannot refund payment in status: ${payment.status}`);
    }

    if (payment.payment_channel === 'cash') {
      throw new Error('Cash payments cannot be refunded through the gateway; reverse manually');
    }
    
    const refundAmount = amount || payment.amount;
    
    if (refundAmount > payment.amount) {
      throw new Error('Refund amount exceeds payment amount');
    }
    
    if (refundAmount <= 0) {
      throw new Error('Invalid refund amount');
    }
    
    const refRaw = payment.gp_transaction_id;
    const referenceNumber = parseInt(String(refRaw).replace(/\D/g, ''), 10);
    if (!Number.isFinite(referenceNumber) || referenceNumber < 1) {
      throw new Error('Invalid gateway transaction reference for refund');
    }

    const refundOpts = {
      reference_number: referenceNumber,
      description: reason || 'Refund',
    };
    if (refundAmount < payment.amount) {
      refundOpts.amount = refundAmount;
    }

    const goatRefund = await goatClient.refundTransaction(refundOpts);
    const newRefundRef =
      goatRefund.reference_number != null
        ? String(goatRefund.reference_number)
        : String(goatRefund.refund_reference || '');

    // Update payment
    payment.status = 'refunded';
    payment.refunded_at = new Date();
    payment.refund_amount = refundAmount;
    payment.refund_reason = reason;
    payment.refund_transaction_id = newRefundRef;
    await payment.save();
    
    // Update COE
    if (payment.coe_id) {
      const coe = await COE.findById(payment.coe_id);
      if (coe) {
        coe.total_paid = Math.max(0, (coe.total_paid || 0) - refundAmount);
        coe.refund_amount = (coe.refund_amount || 0) + refundAmount;
        
        if (refundAmount === payment.amount) {
          // Full refund
          if (payment.payment_type === 'deposit') {
            coe.payment_status = 'unpaid';
            coe.deposit_paid = 0;
            coe.deposit_paid_at = null;
          } else {
            coe.payment_status = 'unpaid'; // Revert to unpaid for full refund
          }
          coe.refunded_at = new Date();
        } else {
          // Partial refund - keep payment_status as 'paid'
          coe.payment_status = 'paid';
        }
        
        await coe.save();
      }
    }
    
    console.log('Refund processed:', {
      payment_id: paymentId,
      refund_amount: refundAmount,
      goat_refund_reference: newRefundRef,
      timestamp: new Date().toISOString()
    });

    return {
      refund_id: newRefundRef,
      amount: refundAmount,
      status: 'completed'
    };
    
  } catch (error) {
    console.error('Refund processing failed:', {
      payment_id: paymentId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Process payment webhook
 * @param {Object} webhookData - Webhook payload
 * @returns {Promise<Object>} Processing result
 */
async function processPaymentWebhook(webhookData) {
  try {
    const { type, reference, id } = webhookData;
    
    // Find payment by reference (our payment _id)
    const payment = await Payment.findById(reference);
    if (!payment) {
      console.error('Payment not found for webhook:', reference);
      return { processed: false, reason: 'Payment not found' };
    }
    
    console.log('Processing webhook:', {
      payment_id: payment._id,
      event_type: type,
      gp_transaction_id: id,
      timestamp: new Date().toISOString()
    });
    
    // Update payment based on webhook event
    switch (type) {
      case 'PAYMENT_AUTHORIZED':
        payment.status = 'authorized';
        payment.gp_authorization_code = webhookData.authorization_code;
        break;
        
      case 'PAYMENT_CAPTURED':
      case 'PAYMENT_COMPLETED':
        // Idempotent: direct card charge + webhook, or CAPTURED + COMPLETED, must not re-run COE updates / notifications
        if (payment.status === 'completed') {
          console.log('[PaymentService] Duplicate completion webhook ignored (idempotent)', {
            payment_id: payment._id?.toString(),
            event_type: type
          });
          return { processed: true, duplicate: true, payment_id: payment._id };
        }
        payment.status = 'completed';
        payment.completed_at = new Date();
        payment.card_brand = webhookData.payment_method?.card?.brand;
        payment.card_last_four = webhookData.payment_method?.card?.last_four;
        payment.gp_response_code = webhookData.response_code;
        payment.gp_response_message = webhookData.response_message;
        
        // Update COE payment status
        await updateCOEPaymentStatus(payment.coe_id, payment);
        break;
        
      case 'PAYMENT_FAILED':
        payment.status = 'failed';
        payment.failed_at = new Date();
        payment.failure_code = webhookData.error_code;
        payment.failure_message = webhookData.error_message;
        
        // Send payment failure notification
        try {
          const notificationService = require('./notificationService');
          const COE = require('../models/COE');
          const coe = await COE.findById(payment.coe_id);
          
          if (coe && payment.user_id) {
            await notificationService.createAndSendNotification(
              payment.user_id.toString(),
              'payment_failed',
              {
                coe_id: payment.coe_id,
                payment_id: payment._id,
                coe: { name: coe.name }
              }
            );
          }
        } catch (error) {
          // Log but don't fail webhook processing if notification fails
          console.error('[PaymentService] Error sending payment failure notification:', error);
        }
        break;
        
      case 'REFUND_COMPLETED':
        // Already handled in processRefund
        break;
        
      default:
        console.log('Unhandled webhook type:', type);
        return { processed: false, reason: 'Unknown event type' };
    }
    
    await payment.save();
    
    console.log('Webhook processed successfully:', {
      payment_id: payment._id,
      event_type: type,
      new_status: payment.status,
      timestamp: new Date().toISOString()
    });
    
    return { processed: true, payment_id: payment._id };
    
  } catch (error) {
    console.error('Webhook processing failed:', {
      webhook_data: webhookData,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Update COE payment status
 * @param {string} coeId - COE ID
 * @param {Object} completedPayment - Completed payment object
 */
/**
 * Record successful adhoc payment on COE (reporting only; does not change payment_status).
 * @param {string} coeId
 * @param {import('mongoose').Document} completedPayment
 */
async function recordAdhocPaymentCompletion(coeId, completedPayment) {
  try {
    if (!coeId || !completedPayment) return;
    const coe = await COE.findById(coeId);
    if (!coe) {
      console.error('[PaymentService] COE not found for adhoc rollup:', coeId);
      return;
    }
    const adhocPayments = await Payment.find({
      coe_id: coeId,
      status: 'completed',
      payment_type: 'adhoc',
    });
    coe.adhoc_collected_total = adhocPayments.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0
    );
    await coe.save();
    console.log('[PaymentService] Adhoc rollup updated:', {
      coe_id: coeId,
      adhoc_collected_total: coe.adhoc_collected_total,
      payment_id: completedPayment._id,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[PaymentService] recordAdhocPaymentCompletion error:', err?.message || err);
  }
}

async function updateCOEPaymentStatus(coeId, completedPayment) {
  try {
    if (!coeId) return;

    if (completedPayment?.payment_type === 'adhoc') {
      await recordAdhocPaymentCompletion(coeId, completedPayment);
      return;
    }
    
    const coe = await COE.findById(coeId);
    if (!coe) {
      console.error('COE not found:', coeId);
      return;
    }
    const previousPaymentStatus = coe.payment_status;
    const previousRevisionState = coe.revision_state;

    // Get all completed payments for this COE (exclude adhoc — on-spot extras must not affect deposit/full status)
    const payments = await Payment.find({ 
      coe_id: coeId, 
      status: 'completed',
      payment_type: { $nin: ['adhoc'] },
    });
    
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    coe.total_paid = totalPaid;
    
    // Determine payment status
    const coeService = require('./coeService');
    let shouldUpdateStatus = false;
    let statusToUpdate = null;
    
    if (totalPaid === 0) {
      coe.payment_status = 'unpaid';
    } else if (completedPayment.payment_type === 'deposit') {
      coe.payment_status = 'deposit_paid';
      coe.deposit_paid = completedPayment.amount;
      coe.deposit_paid_at = new Date();
      coe.deposit_payment_id = completedPayment._id;
      
      // Check if also fully paid (can happen with full_payment)
      if (totalPaid >= coe.total) {
        coe.payment_status = 'paid';
        // Update status to 'paid' if currently in 'approved', 'accepted_not_paid', or 'pending_pay' status
        if (
          coe.status === 'approved' ||
          coe.status === 'accepted_not_paid' ||
          coe.status === 'pending_pay'
        ) {
          shouldUpdateStatus = true;
          statusToUpdate = 'paid';
        }
      }
    } else if (completedPayment.payment_type === 'deposit_diff') {
      // Deposit difference after revision acceptance:
      // keep the COE in `deposit_paid` until it reaches full `paid`.
      coe.payment_status = 'deposit_paid';
      coe.deposit_paid = totalPaid;
      coe.deposit_paid_at = new Date();
      coe.deposit_payment_id = completedPayment._id;

      if (totalPaid >= coe.total) {
        coe.payment_status = 'paid';
        if (
          coe.status === 'approved' ||
          coe.status === 'accepted_not_paid' ||
          coe.status === 'pending_pay'
        ) {
          shouldUpdateStatus = true;
          statusToUpdate = 'paid';
        }
      }
    } else if (completedPayment.payment_type === 'final_payment') {
      if (totalPaid >= coe.total) {
        coe.payment_status = 'paid';
        coe.final_paid_at = new Date();
        coe.final_payment_id = completedPayment._id;
        // Update status to 'paid' if currently in 'approved', 'accepted_not_paid', or 'pending_pay' status
        if (
          coe.status === 'approved' ||
          coe.status === 'accepted_not_paid' ||
          coe.status === 'pending_pay'
        ) {
          shouldUpdateStatus = true;
          statusToUpdate = 'paid';
        }
      } else {
        coe.payment_status = 'unpaid';
      }
    } else if (completedPayment.payment_type === 'full_diff') {
      // Full diff after revision acceptance:
      // it should bring the COE to the updated `total`, therefore resolve the revision.
      if (totalPaid >= coe.total) {
        coe.payment_status = 'paid';
        coe.deposit_paid = totalPaid;
        coe.deposit_paid_at = new Date();
        coe.deposit_payment_id = completedPayment._id;

        if (
          coe.status === 'approved' ||
          coe.status === 'accepted_not_paid' ||
          coe.status === 'pending_pay'
        ) {
          shouldUpdateStatus = true;
          statusToUpdate = 'paid';
        }
      } else {
        // Defensive fallback: if full_diff didn't complete the full amount for some reason
        coe.payment_status = 'deposit_paid';
        coe.deposit_paid = totalPaid;
        coe.deposit_paid_at = new Date();
        coe.deposit_payment_id = completedPayment._id;
      }
    } else if (completedPayment.payment_type === 'full_payment') {
      coe.payment_status = 'paid';
      coe.deposit_paid = completedPayment.amount;
      coe.deposit_paid_at = new Date();
      coe.deposit_payment_id = completedPayment._id;
      // Update status to 'paid' if currently in 'approved', 'accepted_not_paid', or 'pending_pay' status
      if (
        coe.status === 'approved' ||
        coe.status === 'accepted_not_paid' ||
        coe.status === 'pending_pay'
      ) {
        shouldUpdateStatus = true;
        statusToUpdate = 'paid';
      }
    } else if (totalPaid >= coe.total) {
      coe.payment_status = 'paid';
      // Update status to 'paid' if currently in 'approved', 'accepted_not_paid', or 'pending_pay' status
      if (
        coe.status === 'approved' ||
        coe.status === 'accepted_not_paid' ||
        coe.status === 'pending_pay'
      ) {
        shouldUpdateStatus = true;
        statusToUpdate = 'paid';
      }
    } else {
      coe.payment_status = 'unpaid';
    }

    // After revision diff payments, recompute stored dues so list/detail badges match reality.
    const isRevisionDiffPayment =
      completedPayment.payment_type === 'deposit_diff' ||
      completedPayment.payment_type === 'full_diff';
    if (isRevisionDiffPayment && coe.revision_state === 'accepted') {
      const pct =
        typeof coe.revision_deposit_percent_frozen === 'number'
          ? coe.revision_deposit_percent_frozen
          : coe.deposit_percent || 20;
      const totalNum = coe.total || 0;
      const plainCap =
        typeof coe.toObject === 'function'
          ? coe.toObject()
          : { ...coe };
      plainCap.deposit_percent = pct;
      const depositCap = computeInitialDepositPricing(plainCap).total;
      const paidNum = coe.total_paid || 0;
      coe.revision_due_deposit_diff_amount = Math.max(
        0,
        depositCap - Math.min(paidNum, depositCap)
      );
      coe.revision_due_full_diff_amount = Math.max(0, totalNum - paidNum);
    }

    // Revision state resolution:
    // Once the revision is accepted and the COE becomes fully paid for the updated total,
    // mark the revision as resolved.
    if (coe.revision_state === 'accepted' && coe.payment_status === 'paid') {
      coe.revision_state = 'resolved';
      coe.revision_due_deposit_diff_amount = 0;
      coe.revision_due_full_diff_amount = 0;
    }

    // Initial proposal timer no longer applies after full payment; revision flow uses revision_deadline_* only.
    if (coe.payment_status === 'paid') {
      coe.payment_deadline_at = undefined;
      coe.payment_deadline_hours = null;
    }

    // Revision base snapshot persistence:
    // - when we transition to `deposit_paid` for the first time after unpaid
    // - when we transition to `paid` (either directly or after deposit)
    const transitionedToDepositPaid =
      previousPaymentStatus === 'unpaid' && coe.payment_status === 'deposit_paid';
    const transitionedToPaid =
      previousPaymentStatus !== 'paid' && coe.payment_status === 'paid';
    
    // Save payment status first
    await coe.save();

    // Hold seats only when transitioning to paid; release when reverting to unpaid (per HOLD-SEATS-ON-PAYMENT plan)
    if (coe.payment_status === 'unpaid') {
      try {
        await coeService.releaseSelectedSeats(coeId);
      } catch (releaseErr) {
        console.error('[PaymentService] Error releasing seats on revert to unpaid:', releaseErr);
      }
    } else if (previousPaymentStatus === 'unpaid' && (coe.payment_status === 'deposit_paid' || coe.payment_status === 'paid')) {
      try {
        await coeService.holdSeatsForCOE(coeId);
      } catch (holdErr) {
        console.error('[PaymentService] Error holding seats on payment:', holdErr);
      }
    }

    // Update COE status if needed (use coeService to ensure proper side effects: seat booking, date fields)
    if (shouldUpdateStatus && statusToUpdate) {
      await coeService.updateCOEStatus(coeId, statusToUpdate, null);
    }

    // Persist base snapshot for revision flow once per transition.
    // Stored after seat hold / status updates so selected seat statuses are consistent with payment.
    if (transitionedToDepositPaid || transitionedToPaid) {
      try {
        const coeFresh = await COE.findById(coeId);
        if (coeFresh) {
          coeFresh.revision_state = 'none';
          coeFresh.revision_case = null;
          coeFresh.revision_deadline_hours = null;
          coeFresh.revision_deadline_at = undefined;
          coeFresh.revision_due_deposit_diff_amount = 0;
          coeFresh.revision_due_full_diff_amount = 0;
          coeFresh.client_credit_balance = 0;
          coeFresh.revision_deposit_percent_frozen =
            typeof coeFresh.deposit_percent === 'number' ? coeFresh.deposit_percent : null;

          coeFresh.revision_base_snapshot = {
            payment_phase: coeFresh.payment_status === 'paid' ? 'full' : 'deposit',
            payment_status: coeFresh.payment_status,
            total_paid: coeFresh.total_paid,
            subtotal: coeFresh.subtotal,
            taxes: coeFresh.taxes,
            fees: coeFresh.fees,
            total: coeFresh.total,
            fee_breakdown: coeFresh.fee_breakdown,
            deposit_percent: coeFresh.deposit_percent,
            pricing_breakdown: coeFresh.pricing_breakdown,
            events: coeFresh.events,
            selected_seats: coeFresh.selected_seats
          };

          await coeFresh.save();
        }
      } catch (snapshotErr) {
        console.error('[PaymentService] Failed to persist revision base snapshot:', snapshotErr.message);
      }
    }
    
    // Best-effort history logging for payment status changes
    try {
      const { logIncident } = require('./coeHistoryService');
      const paymentType = completedPayment.payment_type;
      const amount = completedPayment.amount;

      const changes = [
        {
          field: 'payment_status',
          label: 'Payment status',
          from: previousPaymentStatus || 'unpaid',
          to: coe.payment_status,
          message: `Payment status changed from ${previousPaymentStatus || 'unpaid'} to ${coe.payment_status}`
        }
      ];

      await logIncident({
        coe,
        coeId,
        userId: completedPayment.user_id,
        userRole: 'client',
        title: 'Payment updated',
        changes,
        metadata: {
          payment_type: paymentType,
          amount
        }
      });

      if (previousRevisionState === 'accepted' && coe.revision_state === 'resolved') {
        await logIncident({
          coe,
          coeId,
          userId: completedPayment.user_id,
          userRole: 'client',
          title: 'Revision payment resolved',
          changes: [
            {
              field: 'revision_state',
              label: 'Revision state',
              from: 'accepted',
              to: 'resolved',
              message: 'Revision diff amounts fully paid'
            }
          ],
          metadata: {
            revision_case: coe.revision_case,
            payment_type: paymentType,
            payment_amount: amount,
            total_paid: coe.total_paid,
            total: coe.total
          }
        });
      }
    } catch (historyErr) {
      console.error('[PaymentService] Failed to log payment history incident:', historyErr.message);
    }

    // Send payment_received only when COE experience status will NOT transition to `paid` here.
    // If it will, updateCOEStatus('paid') sends coe_paid to client + admin (avoids duplicate "Payment received" alerts).
    const skipPaymentReceivedForCoePaid =
      shouldUpdateStatus && statusToUpdate === 'paid';

    if (!skipPaymentReceivedForCoePaid) {
      try {
        const notificationService = require('./notificationService');

        if (completedPayment.user_id) {
          await notificationService.createAndSendNotification(
            completedPayment.user_id.toString(),
            'payment_received',
            {
              coe_id: coeId,
              payment_id: completedPayment._id,
              amount: completedPayment.amount,
              coe: { name: coe.name }
            }
          );
        }

        if (coe.admin_id && coe.admin_id.toString() !== completedPayment.user_id?.toString()) {
          await notificationService.createAndSendNotification(
            coe.admin_id.toString(),
            'payment_received',
            {
              coe_id: coeId,
              payment_id: completedPayment._id,
              amount: completedPayment.amount,
              coe: { name: coe.name },
              is_admin: true
            }
          );
        }
      } catch (error) {
        console.error('[PaymentService] Error sending payment notification:', error);
      }
    }
    
    console.log('COE payment status updated:', {
      coe_id: coeId,
      payment_status: coe.payment_status,
      total_paid: totalPaid,
      coe_status: coe.status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error updating COE payment status:', {
      coe_id: coeId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Get payment history
 * @param {string} coeId - COE ID
 * @returns {Promise<Array>} Payments
 */
async function getPaymentHistory(coeId) {
  try {
    const payments = await Payment.find({ coe_id: coeId })
      .populate('user_id', 'firstName lastName email')
      .sort({ createdAt: -1, _id: -1 });
    
    return payments;
  } catch (error) {
    console.error('Error getting payment history:', error);
    throw error;
  }
}

/**
 * Whether the user may view invoice/payment detail (owner or admin for on-spot charges).
 * @param {import('mongoose').Document|object} payment
 * @param {string} userId
 * @param {boolean} [isAdmin]
 * @returns {boolean}
 */
function canAccessPaymentRecord(payment, userId, isAdmin = false) {
  const ownerId =
    payment.user_id?._id?.toString?.() || payment.user_id?.toString?.();
  if (ownerId && ownerId === userId.toString()) {
    return true;
  }
  return Boolean(isAdmin && payment.payment_type === 'adhoc');
}

/**
 * Get payment by ID
 * @param {string} paymentId - Payment ID
 * @returns {Promise<Object>} Payment
 */
async function getPaymentById(paymentId) {
  try {
    const payment = await Payment.findById(paymentId)
      .populate('user_id', 'firstName lastName email phone')
      .populate('coe_id', 'name total currency is_the1_event original_request_data');
    
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    return payment;
  } catch (error) {
    console.error('Error getting payment:', error);
    throw error;
  }
}

/**
 * Get user payment history with filters and pagination
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options { status, payment_type, coe_id, start_date, end_date }
 * @param {Object} pagination - Pagination options { page, limit }
 * @returns {Promise<Object>} Payments with pagination and summary
 */
async function getUserPaymentHistory(userId, filters = {}, pagination = {}) {
  try {
    const {
      status,
      payment_type,
      coe_id,
      start_date,
      end_date
    } = filters;
    
    const page = parseInt(pagination.page) || 1;
    const limit = Math.min(parseInt(pagination.limit) || 20, 100); // Max 100 per page
    const skip = (page - 1) * limit;
    
    // Build query
    const query = { user_id: userId };
    
    if (status) {
      query.status = status;
    }
    
    if (payment_type) {
      query.payment_type = payment_type;
    }
    
    if (coe_id) {
      query.coe_id = coe_id;
    }
    
    if (start_date || end_date) {
      query.created_at = {};
      if (start_date) {
        query.created_at.$gte = new Date(start_date);
      }
      if (end_date) {
        query.created_at.$lte = new Date(end_date);
      }
    }
    
    // Get total count for pagination
    const total = await Payment.countDocuments(query);
    
    // Get payments with pagination
    const payments = await Payment.find(query)
      .populate('coe_id', 'name is_the1_event original_request_data')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Calculate summary statistics
    const allUserPayments = await Payment.find({ user_id: userId }).lean();
    const totalAmount = allUserPayments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalRefunded = allUserPayments
      .filter(p => p.status === 'refunded')
      .reduce((sum, p) => sum + (p.refund_amount || 0), 0);
    const netAmount = totalAmount - totalRefunded;
    
    const { withAdhocPaymentSummary } = require('../utils/adhocPaymentDisplay');

    // Format payments with COE name and adhoc payer line when applicable
    const formattedPayments = payments.map(payment =>
      withAdhocPaymentSummary({
        ...payment,
        coe_name: payment.coe_id?.name || null,
        is_the1_event:
          payment.coe_id?.is_the1_event === true ||
          payment.coe_id?.original_request_data?.is_the1_event === true,
        coe_id: payment.coe_id?._id || payment.coe_id || null,
      })
    );
    
    return {
      payments: formattedPayments,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      },
      summary: {
        total_payments: total,
        total_amount: totalAmount,
        total_refunded: totalRefunded,
        net_amount: netAmount
      }
    };
  } catch (error) {
    console.error('Error getting user payment history:', error);
    throw error;
  }
}

/**
 * Get invoice data for a payment
 * @param {string} paymentId - Payment ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Invoice data
 */
async function getInvoiceData(paymentId, userId, options = {}) {
  try {
    const isAdmin = Boolean(options.isAdmin);
    // Get payment with populated data
    const payment = await Payment.findById(paymentId)
      .populate('user_id', 'firstName lastName email phone')
      .populate({
        path: 'coe_id',
        select: 'name description total subtotal tax currency events selected_seats is_the1_event original_request_data',
        populate: {
          path: 'events.event_id',
          select: 'name description start_datetime end_datetime base_price'
        }
      });
    
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    if (!canAccessPaymentRecord(payment, userId, isAdmin)) {
      throw new Error('Unauthorized: You can only access your own invoices');
    }
    
    // Generate invoice number (using payment ID first 8 chars)
    const invoiceNumber = `INV-${payment._id.toString().substring(0, 8).toUpperCase()}`;
    
    const {
      formatAdhocPaidByLine,
      getAdhocInvoiceBillTo,
    } = require('../utils/adhocPaymentDisplay');
    const adhocPaymentSummary = formatAdhocPaidByLine(payment);
    const adhocBillTo = getAdhocInvoiceBillTo(payment);

    // Format invoice data
    const invoice = {
      invoice_number: invoiceNumber,
      invoice_date: payment.created_at,
      payment_date: payment.completed_at || payment.created_at,
      status: payment.status === 'completed' ? 'paid' : payment.status,
      
      // Bill To — on-spot payer when adhoc; otherwise COE account owner
      bill_to:
        adhocBillTo || {
          name: `${payment.user_id.firstName} ${payment.user_id.lastName}`,
          email: payment.user_id.email,
          phone: payment.user_id.phone || null,
        },
      
      // COE Details
      coe: payment.coe_id ? {
        _id: payment.coe_id._id,
        name: payment.coe_id.name,
        description: payment.coe_id.description || '',
        is_the1_event:
          payment.coe_id.is_the1_event === true ||
          payment.coe_id.original_request_data?.is_the1_event === true,
        events: (payment.coe_id.events || []).map(event => ({
          event_name: event.event_id?.name || 'Event',
          event_date: event.event_date || event.event_id?.start_datetime,
          base_price: event.base_price || event.event_id?.base_price || 0
        }))
      } : null,
      
      // Payment Details
      payment: {
        _id: payment._id,
        amount: payment.amount,
        currency: payment.currency || 'USD',
        payment_type: payment.payment_type,
        payment_channel: payment.payment_channel || 'card',
        payment_method: {
          brand: payment.payment_channel === 'cash' ? 'Cash' : (payment.card_brand || 'N/A'),
          last_four: payment.payment_channel === 'cash' ? '' : (payment.card_last_four || 'N/A')
        },
        adhoc_payment_summary: adhocPaymentSummary || undefined,
        is_the1_event:
          payment.coe_id?.is_the1_event === true ||
          payment.coe_id?.original_request_data?.is_the1_event === true,
        transaction_id: payment.gp_transaction_id || 'N/A',
        completed_at: payment.completed_at
      },
      
      // Pricing Breakdown (from COE if available, otherwise from payment)
      pricing: {
        subtotal: payment.coe_id?.subtotal || payment.amount,
        taxes: payment.coe_id?.tax || 0,
        fees: 0,
        total: payment.amount
      },
      
      // Refund Information
      refund: {
        refund_amount: payment.refund_amount || 0,
        refunded_at: payment.refunded_at || null,
        refund_reason: payment.refund_reason || null
      }
    };
    
    return invoice;
  } catch (error) {
    console.error('Error getting invoice data:', error);
    throw error;
  }
}

/**
 * Process GOAT gateway webhook (payload shape may vary; best-effort mapping).
 * @param {Object} body - Parsed JSON body
 * @returns {Promise<Object>}
 */
async function processGoatWebhook(body) {
  try {
    const ref =
      body.reference ||
      body.order_id ||
      body.transaction_details?.order_number ||
      body.transaction_details?.key ||
      body.key;
    let payment = null;

    if (ref && /^[a-f0-9]{24}$/i.test(String(ref))) {
      payment = await Payment.findById(ref);
    }
    if (!payment && body.reference_number != null) {
      payment = await Payment.findOne({
        gp_transaction_id: String(body.reference_number),
      });
    }

    if (!payment) {
      console.warn('[GOAT Webhook] Payment not found', {
        snippet: JSON.stringify(body).slice(0, 400),
      });
      return { processed: false, reason: 'Payment not found' };
    }

    const typeStr = `${body.type || body.event_type || body.status || ''}`.toLowerCase();
    const failed =
      typeStr.includes('declin') ||
      typeStr.includes('fail') ||
      body.status_code === 'D' ||
      body.status_code === 'E';

    if (failed) {
      if (payment.status === 'completed') {
        return { processed: true, duplicate: true, payment_id: payment._id };
      }
      payment.status = 'failed';
      payment.failed_at = new Date();
      payment.failure_message =
        body.error_message || body.message || 'Payment declined';
      await payment.save();
      return { processed: true, payment_id: payment._id };
    }

    const ok =
      body.status_code === 'A' ||
      (body.status && String(body.status).toLowerCase() === 'approved') ||
      typeStr.includes('approv') ||
      typeStr.includes('captur') ||
      typeStr.includes('complet');

    if (ok) {
      if (payment.status === 'completed') {
        return { processed: true, duplicate: true, payment_id: payment._id };
      }
      payment.status = 'completed';
      payment.completed_at = new Date();
      if (body.last_4 != null) payment.card_last_four = String(body.last_4);
      if (body.card_type) payment.card_brand = String(body.card_type);
      payment.gp_response_message = body.error_message || payment.gp_response_message;
      await payment.save();
      if (payment.coe_id) {
        await updateCOEPaymentStatus(payment.coe_id, payment);
      }
      return { processed: true, payment_id: payment._id };
    }

    console.log('[GOAT Webhook] Unhandled event shape', {
      type: body.type || body.event_type,
      status: body.status,
    });
    return { processed: false, reason: 'Unknown event type' };
  } catch (error) {
    console.error('GOAT webhook processing failed:', error);
    throw error;
  }
}

/**
 * Verify GOAT webhook signature (HMAC-SHA256 of JSON body; align header with GOAT docs when finalized).
 * @param {Object} payload - Webhook payload
 * @param {string} signature - Signature from header (e.g. x-signature)
 * @returns {boolean} Valid
 */
function verifyGoatWebhookSignature(payload, signature) {
  try {
    const secret = process.env.GOAT_WEBHOOK_SIGNATURE;
    if (!secret) {
      console.warn(
        'GOAT_WEBHOOK_SIGNATURE not configured, skipping signature verification'
      );
      return true;
    }
    if (!signature) {
      return false;
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    return signature === expected;
  } catch (error) {
    console.error('GOAT webhook signature verification failed:', error);
    return false;
  }
}

/**
 * @deprecated Legacy name; use verifyGoatWebhookSignature for GOAT.
 */
function verifyWebhookSignature(payload, signature) {
  return verifyGoatWebhookSignature(payload, signature);
}

/**
 * Tokenize and save card (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {Object} cardDetails - Card details
 * @param {boolean} setAsDefault - Set as default
 * @returns {Promise<Object>} Token data
 */
async function tokenizeAndSaveCard(userId, cardDetails, setAsDefault = true) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const expiryMonth = parseInt(String(cardDetails.expiry_month), 10);
    let expiryYear = parseInt(String(cardDetails.expiry_year), 10);
    if (expiryYear < 100) {
      expiryYear += 2000;
    }

    const { cardRef } = await goatClient.createSavedCardFromCardNumber({
      card: String(cardDetails.number).replace(/\s/g, ''),
      expiry_month: expiryMonth,
      expiry_year: expiryYear,
    });

    const tokenId = String(cardRef);
    const sourceProbe = goatClient.toSourceToken(tokenId);
    if (sourceProbe.length > goatClient.GOAT_MAX_SOURCE_LENGTH) {
      throw new Error(
        'GOAT returned a card token that exceeds gateway length limits. Try again or contact support.'
      );
    }

    const cardLastFour = String(cardDetails.number || '')
      .replace(/\D/g, '')
      .slice(-4);
    const cardInfo = {
      brand: detectCardBrand(String(cardDetails.number).replace(/\s/g, '')),
    };
    
    // Create card fingerprint for duplicate detection
    const cardFingerprint = `${cardLastFour}-${cardDetails.expiry_month}-${cardDetails.expiry_year}`;
    
    // Check for existing card with same fingerprint
    const existingCardIndex = user.saved_payment_methods.findIndex(method => 
      method.card_last_four === cardLastFour && 
      method.expiry_month === cardDetails.expiry_month && 
      method.expiry_year === cardDetails.expiry_year
    );
    
    let action = 'added';
    let oldTokenId = null;
    
    if (existingCardIndex !== -1) {
      // Update existing card
      const existingCard = user.saved_payment_methods[existingCardIndex];
      oldTokenId = existingCard.token_id;
      
      // Update the existing card with new token and info
      user.saved_payment_methods[existingCardIndex] = {
        ...existingCard,
        token_id: tokenId,
        card_brand: cardInfo.brand,
        card_last_four: cardLastFour,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        nickname: cardDetails.nickname || existingCard.nickname || `${cardInfo.brand} •••• ${cardLastFour || 'XXXX'}`,
        updated_at: new Date(),
        update_history: [
          ...(existingCard.update_history || []),
          {
            old_token_id: oldTokenId,
            updated_at: new Date(),
            reason: 'card_tokenization'
          }
        ]
      };
      
      action = 'updated';
    } else {
      // Check card limit (max 5 cards)
      if (user.saved_payment_methods.length >= 5) {
        throw new Error('Maximum of 5 payment methods allowed. Please remove an existing card first.');
      }
      
      // Add new card
      const savedMethod = {
        token_id: tokenId,
        card_brand: cardInfo.brand,
        card_last_four: cardLastFour,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        is_default: setAsDefault || user.saved_payment_methods.length === 0,
        nickname: cardDetails.nickname || `${cardInfo.brand} •••• ${cardLastFour || 'XXXX'}`,
        created_at: new Date(),
        update_history: []
      };
      
      user.saved_payment_methods.push(savedMethod);
    }
    
    if (setAsDefault || !user.default_payment_method) {
      user.default_payment_method = tokenId;
      user.saved_payment_methods.forEach(m => {
        m.is_default = (m.token_id === tokenId);
      });
    }
    
    await user.save();
    
    console.log('Card tokenized and saved:', {
      user_id: userId,
      token_id: tokenId,
      card_last_four: cardLastFour,
      action: action,
      old_token_id: oldTokenId,
      timestamp: new Date().toISOString()
    });
    
    // Find the current card to get is_default status
    const currentCard = user.saved_payment_methods.find(method => method.token_id === tokenId);
    
    return {
      token_id: tokenId,
      card_brand: cardInfo.brand,
      card_last_four: cardLastFour,
      is_default: currentCard ? currentCard.is_default : false,
      action: action,
      old_token_id: oldTokenId
    };
  } catch (error) {
    console.error('Card tokenization failed:', {
      user_id: userId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Build a stable customer display name for GOAT payloads.
 * @param {object} user
 * @returns {string}
 */
function getCustomerDisplayName(user) {
  return [user?.firstName, user?.lastName]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(' ');
}

/**
 * Parse positive integer ids from mixed API values.
 * @param {any} value
 * @returns {number|null}
 */
function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Resolve or create GOAT customer id for a THEONE user.
 * @param {object} userDoc
 * @returns {Promise<number>}
 */
async function ensureGoatCustomerId(userDoc) {
  const userIdStr = userDoc?._id ? String(userDoc._id) : '';
  if (!userIdStr) {
    throw new Error('Cannot resolve GOAT customer without user id');
  }

  const cachedId = toPositiveInt(userDoc.goat_customer_id);
  if (cachedId) return cachedId;

  const listQuery = {
    customer_number: userIdStr,
    limit: 1,
    order: 'asc',
  };

  const persistCustomerId = async (customerId) => {
    await User.updateOne(
      { _id: userDoc._id },
      { $set: { goat_customer_id: customerId } },
    );
    userDoc.goat_customer_id = customerId;
    return customerId;
  };

  const findExisting = async () => {
    const rows = await goatClient.listCustomers(listQuery);
    const first = Array.isArray(rows) && rows.length ? rows[0] : null;
    return toPositiveInt(first?.id);
  };

  try {
    const existingId = await findExisting();
    if (existingId) {
      return await persistCustomerId(existingId);
    }

    const customerName = getCustomerDisplayName(userDoc);
    const fallbackIdentifier =
      String(userDoc.email || '').trim() || `user-${userIdStr.slice(-12)}`;
    const createPayload = {
      identifier: (customerName || fallbackIdentifier).slice(0, 255),
      customer_number: userIdStr,
      email: userDoc.email || undefined,
      first_name: userDoc.firstName || undefined,
      last_name: userDoc.lastName || undefined,
      phone: userDoc.phone || undefined,
    };

    const created = await goatClient.createCustomer(createPayload);
    const createdId = toPositiveInt(created?.id);
    if (!createdId) {
      throw new Error('GOAT create customer did not return id');
    }
    return await persistCustomerId(createdId);
  } catch (err) {
    try {
      const relistedId = await findExisting();
      if (relistedId) {
        return await persistCustomerId(relistedId);
      }
    } catch (relistErr) {
      console.error('[GOAT] customer relist failed after create/list error', {
        user_id: userIdStr,
        customer_number: userIdStr,
        error: relistErr?.message || relistErr,
        timestamp: new Date().toISOString(),
      });
    }
    console.error('[GOAT] ensure customer failed', {
      user_id: userIdStr,
      customer_number: userIdStr,
      error: err?.message || err,
      timestamp: new Date().toISOString(),
    });
    throw err;
  }
}

/**
 * Charge saved card (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {string} tokenId - Saved GOAT cardRef (stored in user.saved_payment_methods)
 * @param {number} amount - Amount
 * @param {string} description - Description
 * @param {string} coeId - COE ID (optional)
 * @param {string} paymentType - 'deposit' | 'final_payment' | 'full_payment' | 'subscription' (optional; used when coeId is set)
 * @returns {Promise<Object>} Payment result
 */
async function chargeSavedCard(userId, tokenId, amount, description, coeId = null, paymentType = null) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const savedMethod = user.saved_payment_methods.find(m => m.token_id === tokenId);
    if (!savedMethod) {
      throw new Error('Payment method not found or unauthorized');
    }
    
    const resolvedPaymentType = paymentType || (coeId ? 'final_payment' : 'subscription');
    
    // Create payment record
    const payment = new Payment({
      coe_id: coeId,
      user_id: userId,
      amount,
      currency: PAYMENT_CONFIG.currency,
      payment_type: resolvedPaymentType,
      payment_token_id: tokenId,
      is_token_payment: true,
      status: 'pending',
      description
    });
    await payment.save();

    const source = goatClient.toSourceToken(tokenId);
    const customerName = getCustomerDisplayName(user);
    const userIdStr = user._id ? String(user._id) : String(userId);
    const goatCustomerId = await ensureGoatCustomerId(user);
    let goatData;
    const chargeRequest = {
      amount,
      source,
      description,
      orderNumber: payment._id.toString(),
      customerName,
      customer: {
        customer_id: goatCustomerId,
        identifier: userIdStr,
        email: user.email || undefined,
      },
    };
    try {
      goatData = await goatClient.chargeWithSource(chargeRequest);
    } catch (goatErr) {
      const isTimeoutError =
        goatErr?.code === 'ECONNABORTED' ||
        /timeout/i.test(goatErr?.message || '');
      if (isTimeoutError) {
        // Retry once with the same order number. GOAT duplicate protection is enabled,
        // so this safely reconciles transient timeout responses.
        try {
          goatData = await goatClient.chargeWithSource(chargeRequest);
        } catch (retryErr) {
          goatErr = retryErr;
        }
      }
      if (goatData) {
        // First attempt timed out but retry returned a charge response.
        // Continue regular approval flow below.
      } else {
      let msg =
        goatErr.message ||
        goatErr.response?.data?.error_message ||
        goatErr.response?.data?.message ||
        'Payment failed. Please try again.';
      if (/timeout/i.test(msg)) {
        msg =
          'Payment gateway timed out. Please try again in a moment.';
      } else if (
        goatErr.response &&
        /validation|invalid|source|token|not found|unauthoriz/i.test(msg) &&
        !/GOAT_SOURCE_KEY/i.test(msg)
      ) {
        msg +=
          ' If this card was saved before the GOAT migration, remove it in the app and add the card again.';
      }
      payment.status = 'failed';
      payment.failure_message = msg;
      payment.failed_at = new Date();
      await payment.save();
      throw new Error(msg);
      }
    }

    if (!goatClient.isChargeApproved(goatData)) {
      const msg =
        goatData.error_message ||
        goatData.message ||
        'Payment was not approved';
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
    payment.card_brand = goatData.card_type || savedMethod.card_brand;
    payment.card_last_four =
      goatData.last_4 != null
        ? String(goatData.last_4)
        : savedMethod.card_last_four;
    await payment.save();
    
    // Update last used
    savedMethod.last_used_at = new Date();
    await user.save();
    
    // Update COE if applicable (adhoc uses dedicated rollup only)
    if (coeId && payment.payment_type !== 'adhoc') {
      await updateCOEPaymentStatus(coeId, payment);
    } else if (coeId && payment.payment_type === 'adhoc') {
      await recordAdhocPaymentCompletion(coeId, payment);
    }

    // Fire-and-forget: post-charge receipt email (SES). Never fail the charge response.
    setImmediate(() => {
      (async () => {
        try {
          let resolvedCoeName = null;
          if (coeId) {
            const coeDoc = await COE.findById(coeId).select('name').lean();
            resolvedCoeName = coeDoc?.name || null;
          }
          await sendPaymentReceiptEmail({
            user,
            payment,
            coeName: resolvedCoeName,
          });
        } catch (err) {
          console.error('[PaymentReceiptEmail] async error:', err?.message || err);
        }
      })();
    });

    console.log('Saved card charged:', {
      user_id: userId,
      token_id: tokenId,
      amount,
      payment_id: payment._id,
      timestamp: new Date().toISOString()
    });
    
    return payment;
  } catch (error) {
    console.error('Charge saved card failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Remove saved card (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<boolean>} Success
 */
async function removeSavedCard(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const methodIndex = user.saved_payment_methods.findIndex(m => m.token_id === tokenId);
    if (methodIndex === -1) {
      throw new Error('Payment method not found');
    }
    
    const wasDefault = user.saved_payment_methods[methodIndex].is_default;
    
    user.saved_payment_methods.splice(methodIndex, 1);
    
    if (wasDefault && user.saved_payment_methods.length > 0) {
      user.saved_payment_methods[0].is_default = true;
      user.default_payment_method = user.saved_payment_methods[0].token_id;
    } else if (user.saved_payment_methods.length === 0) {
      user.default_payment_method = null;
    }
    
    await user.save();

    console.log('Payment method removed:', {
      user_id: userId,
      token_id: tokenId,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Remove card failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Set default payment method (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<boolean>} Success
 */
async function setDefaultPaymentMethod(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const method = user.saved_payment_methods.find(m => m.token_id === tokenId);
    if (!method) {
      throw new Error('Payment method not found');
    }
    
    user.saved_payment_methods.forEach(m => {
      m.is_default = (m.token_id === tokenId);
    });
    
    user.default_payment_method = tokenId;
    await user.save();
    
    console.log('Default payment method updated:', {
      user_id: userId,
      token_id: tokenId,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Set default payment method failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Update saved card metadata (expiry, nickname)
 * @param {string} userId
 * @param {string} tokenId
 * @param {{nickname?: string, expiry_month?: string, expiry_year?: string}} updates
 */
async function updateSavedCard(userId, tokenId, updates = {}) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const method = user.saved_payment_methods.find(m => m.token_id === tokenId);
    if (!method) {
      throw new Error('Payment method not found');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'nickname')) {
      method.nickname = updates.nickname;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'expiry_month')) {
      method.expiry_month = updates.expiry_month;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'expiry_year')) {
      method.expiry_year = updates.expiry_year;
    }

    await user.save();

    console.log('Saved card updated:', {
      user_id: userId,
      token_id: tokenId,
      has_nickname: Object.prototype.hasOwnProperty.call(updates, 'nickname'),
      has_expiry_month: Object.prototype.hasOwnProperty.call(updates, 'expiry_month'),
      has_expiry_year: Object.prototype.hasOwnProperty.call(updates, 'expiry_year'),
      timestamp: new Date().toISOString()
    });

    return true;
  } catch (error) {
    console.error('Update saved card failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

const EXPERIENCE_UNDO_PAYMENT_TYPES = ['deposit', 'full_payment', 'final_payment'];

/**
 * Parse GOAT reference_number from a Payment's gp_transaction_id.
 * @param {object} payment
 * @returns {number}
 */
function parseExperienceGoatReference(payment) {
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
function mapExperienceGoatUndoType(goatBody, mode) {
  const raw = goatBody?.type != null ? String(goatBody.type).toLowerCase() : '';
  if (raw === 'void' || raw === 'refund' || raw === 'adjust') {
    return raw;
  }
  return mode === 'void' ? 'void' : 'refund';
}

/**
 * Find the latest completed experience payment (deposit/full/final) for a COE.
 * @param {string|import('mongoose').Types.ObjectId} coeId
 * @returns {Promise<object|null>}
 */
async function findLatestCompletedExperiencePayment(coeId) {
  if (!coeId) return null;
  return Payment.findOne({
    coe_id: coeId,
    status: 'completed',
    payment_type: { $in: EXPERIENCE_UNDO_PAYMENT_TYPES },
  })
    .sort({ completed_at: -1, createdAt: -1 })
    .lean();
}

/**
 * Build admin undo affordance payload for a completed experience payment.
 * @param {object|null} payment
 * @returns {{ payment_id: string, payment_type: string, amount: number, can_undo: boolean }|null}
 */
function buildExperiencePaymentUndoPayload(payment) {
  if (!payment) return null;
  const id = payment._id?.toString?.() || String(payment._id || '');
  if (!id) return null;
  return {
    payment_id: id,
    payment_type: payment.payment_type,
    amount: roundCurrency(payment.amount || 0),
    can_undo: true,
  };
}

/**
 * Serialize cancelled/refunded experience payments for client payment summary.
 * @param {string|import('mongoose').Types.ObjectId} coeId
 * @returns {Promise<object[]>}
 */
async function listExperiencePaymentUndos(coeId) {
  if (!coeId) return [];
  const payments = await Payment.find({
    coe_id: coeId,
    payment_type: { $in: EXPERIENCE_UNDO_PAYMENT_TYPES },
    status: { $in: ['cancelled', 'refunded'] },
    goat_undo_type: { $in: ['void', 'refund', 'adjust'] },
  })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  return payments.map((p) => ({
    payment_id: p._id.toString(),
    payment_type: p.payment_type,
    amount: roundCurrency(p.amount || 0),
    status: p.status,
    goat_undo_type: p.goat_undo_type || null,
    refund_amount: p.refund_amount != null ? roundCurrency(p.refund_amount) : null,
    undone_at: p.refunded_at
      ? new Date(p.refunded_at).toISOString()
      : p.updatedAt
        ? new Date(p.updatedAt).toISOString()
        : null,
  }));
}

/**
 * Attach experience void/reversal fields onto a COE response object.
 * @param {object} coe - mongoose doc or plain object
 * @param {{ isAdmin?: boolean }} [opts]
 * @returns {Promise<void>}
 */
async function attachExperiencePaymentUndoFields(coe, opts = {}) {
  try {
    if (!coe) return;
    const coeId = coe._id?.toString?.() || coe.id?.toString?.() || null;
    if (!coeId) return;

    const undos = await listExperiencePaymentUndos(coeId);
    assignRuntimeCoeField(coe, 'experience_payment_undos', undos);

    if (opts.isAdmin === true) {
      const latest = await findLatestCompletedExperiencePayment(coeId);
      assignRuntimeCoeField(coe, 'experience_payment_undo', buildExperiencePaymentUndoPayload(latest));
    }
  } catch (error) {
    console.warn('[PaymentService] attachExperiencePaymentUndoFields failed:', error.message);
  }
}

/**
 * Assign a runtime-only field on a mongoose doc or plain object.
 * @param {object} target
 * @param {string} key
 * @param {*} value
 */
function assignRuntimeCoeField(target, key, value) {
  if (!target) return;
  if (typeof target.set === 'function') {
    target.set(key, value);
    return;
  }
  target[key] = value;
}

/**
 * Recalculate COE payment_status / total_paid after an experience payment undo.
 * @param {string} coeId
 * @param {object} undonePayment
 * @param {'void'|'refund'|'adjust'} undoType
 * @param {string|null} adminUserId
 * @returns {Promise<object>} updated COE
 */
async function rollbackCoeAfterExperiencePaymentUndo(coeId, undonePayment, undoType, adminUserId) {
  const coe = await COE.findById(coeId);
  if (!coe) {
    throw new Error('Experience not found after payment undo');
  }

  const previousPaymentStatus = coe.payment_status || 'unpaid';
  const previousStatus = coe.status;
  const undoneType = undonePayment.payment_type;
  const undoAmount = roundCurrency(undonePayment.amount || 0);

  const remaining = await Payment.find({
    coe_id: coeId,
    status: 'completed',
    payment_type: { $nin: ['adhoc'] },
  });

  const byRecency = (a, b) =>
    new Date(b.completed_at || b.createdAt || 0) - new Date(a.completed_at || a.createdAt || 0);

  const totalPaid = roundCurrency(
    remaining.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
  );
  coe.total_paid = totalPaid;

  const depositPayment = remaining
    .filter((p) => p.payment_type === 'deposit' || p.payment_type === 'deposit_diff')
    .sort(byRecency)[0];
  const finalPayment = remaining
    .filter((p) => p.payment_type === 'final_payment')
    .sort(byRecency)[0];
  const fullPayment = remaining
    .filter((p) => p.payment_type === 'full_payment' || p.payment_type === 'full_diff')
    .sort(byRecency)[0];

  if (undoType === 'refund' || undoType === 'adjust') {
    coe.refund_amount = roundCurrency((Number(coe.refund_amount) || 0) + undoAmount);
    coe.refunded_at = new Date();
    coe.refund_reason =
      undoneType === 'deposit'
        ? 'Experience deposit reversed'
        : undoneType === 'final_payment'
          ? 'Experience final payment reversed'
          : 'Experience full payment reversed';
    coe.refund_status = totalPaid <= 0 ? 'full' : 'partial';
  }

  // Clear then re-apply from remaining completed payments
  coe.deposit_payment_id = undefined;
  coe.final_payment_id = undefined;
  coe.final_paid_at = undefined;
  coe.payment_id = undefined;

  if (fullPayment) {
    coe.payment_status = 'paid';
    coe.deposit_paid = Number(fullPayment.amount) || totalPaid;
    coe.deposit_paid_at = fullPayment.completed_at || fullPayment.createdAt || new Date();
    coe.deposit_payment_id = fullPayment._id;
    coe.payment_id = fullPayment._id;
  } else if (finalPayment && depositPayment) {
    coe.payment_status = 'paid';
    coe.deposit_paid = Number(depositPayment.amount) || 0;
    coe.deposit_paid_at = depositPayment.completed_at || depositPayment.createdAt || new Date();
    coe.deposit_payment_id = depositPayment._id;
    coe.final_payment_id = finalPayment._id;
    coe.final_paid_at = finalPayment.completed_at || finalPayment.createdAt || new Date();
    coe.payment_id = finalPayment._id;
  } else if (depositPayment) {
    coe.payment_status = 'deposit_paid';
    coe.deposit_paid = Number(depositPayment.amount) || totalPaid;
    coe.deposit_paid_at = depositPayment.completed_at || depositPayment.createdAt || new Date();
    coe.deposit_payment_id = depositPayment._id;
    coe.payment_id = depositPayment._id;
  } else if (totalPaid > 0 && totalPaid >= (Number(coe.total) || 0)) {
    coe.payment_status = 'paid';
    coe.deposit_paid = totalPaid;
  } else if (totalPaid > 0) {
    coe.payment_status = 'deposit_paid';
    coe.deposit_paid = totalPaid;
  } else {
    coe.payment_status = 'unpaid';
    coe.deposit_paid = 0;
    coe.deposit_paid_at = undefined;
  }

  await coe.save();

  const coeService = require('./coeService');
  if (coe.payment_status === 'unpaid') {
    try {
      await coeService.releaseSelectedSeats(coeId);
    } catch (releaseErr) {
      console.error('[PaymentService] Error releasing seats after experience undo:', releaseErr);
    }
  } else if (
    previousPaymentStatus === 'paid' &&
    coe.payment_status === 'deposit_paid'
  ) {
    // Fully paid seats were booked; re-hold after final/full undo leaves a deposit
    try {
      await coeService.holdSeatsForCOE(coeId);
    } catch (holdErr) {
      console.error('[PaymentService] Error re-holding seats after experience undo:', holdErr);
    }
  }

  // paid → approved is not a valid updateCOEStatus transition; set directly so Pay CTAs work
  if (
    previousStatus === 'paid' &&
    (coe.payment_status === 'unpaid' || coe.payment_status === 'deposit_paid')
  ) {
    try {
      const coeFresh = await COE.findById(coeId);
      if (coeFresh && coeFresh.status === 'paid') {
        coeFresh.status = 'approved';
        coeFresh.paid_date = undefined;
        await coeFresh.save();
      }
    } catch (statusErr) {
      console.error('[PaymentService] Error reverting COE status after experience undo:', {
        coe_id: coeId,
        error: statusErr.message,
      });
    }
  }

  console.log('[PaymentService] COE rolled back after experience payment undo', {
    coe_id: coeId,
    undone_payment_id: undonePayment._id?.toString?.(),
    undone_type: undoneType,
    previous_payment_status: previousPaymentStatus,
    new_payment_status: coe.payment_status,
    total_paid: coe.total_paid,
    admin_id: adminUserId || null,
    timestamp: new Date().toISOString(),
  });

  return COE.findById(coeId);
}

/**
 * Admin void or reversal of a completed experience payment (deposit / full / final).
 * Targets only the given payment on its COE; does not undo subscription dual-charge.
 * @param {string} adminUserId
 * @param {string} paymentId
 * @param {{ mode: 'void'|'reversal', coeId?: string }} opts
 * @returns {Promise<object>} updated payment plain object
 */
async function undoExperiencePayment(adminUserId, paymentId, opts) {
  const mode = opts?.mode;
  if (mode !== 'void' && mode !== 'reversal') {
    throw new Error('Undo mode must be void or reversal');
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }
  if (!EXPERIENCE_UNDO_PAYMENT_TYPES.includes(payment.payment_type)) {
    throw new Error('Only deposit, full, or final experience payments can be voided or reversed here');
  }
  if (opts?.coeId && String(payment.coe_id) !== String(opts.coeId)) {
    throw new Error('Payment does not belong to this experience');
  }
  if (payment.status !== 'completed') {
    throw new Error(`Cannot undo payment in status: ${payment.status}`);
  }

  const coeId = payment.coe_id?.toString?.() || String(payment.coe_id || '');
  if (!coeId) {
    throw new Error('Payment is not linked to an experience');
  }

  const latest = await findLatestCompletedExperiencePayment(coeId);
  if (!latest || String(latest._id) !== String(payment._id)) {
    throw new Error(
      'Only the latest completed experience payment can be undone. Undo the more recent payment first.',
    );
  }

  const description =
    mode === 'void' ? 'Experience payment void' : 'Experience payment reversal';

  let undoType = mode === 'void' ? 'void' : 'refund';

  if (payment.payment_channel === 'cash' || !payment.gp_transaction_id) {
    // Local undo: cash or missing gateway ref (no GOAT call)
    undoType = mode === 'void' ? 'void' : 'refund';
    payment.goat_undo_type = undoType;
    payment.refund_reason = description;
    if (undoType === 'void') {
      payment.status = 'cancelled';
    } else {
      payment.status = 'refunded';
      payment.refund_amount = Number(payment.amount) || 0;
      payment.refunded_at = new Date();
    }
    await payment.save();
  } else {
    const referenceNumber = parseExperienceGoatReference(payment);
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
      console.error('[PaymentService] GOAT experience undo failed', {
        payment_id: paymentId,
        mode,
        admin_id: adminUserId,
        error: goatErr.message,
        timestamp: new Date().toISOString(),
      });
      throw goatErr;
    }

    undoType = mapExperienceGoatUndoType(goatBody, mode);
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
  }

  await rollbackCoeAfterExperiencePaymentUndo(coeId, payment, undoType, adminUserId);

  console.log('[PaymentService] experience payment undo completed', {
    payment_id: paymentId,
    coe_id: coeId,
    mode,
    goat_undo_type: undoType,
    admin_id: adminUserId,
    timestamp: new Date().toISOString(),
  });

  return payment.toObject ? payment.toObject() : payment;
}

module.exports = {
  createPaymentIntent,
  prepareCoePaymentCharge,
  recordCashCoePayment,
  processRefund,
  processPaymentWebhook,
  processGoatWebhook,
  updateCOEPaymentStatus,
  recordAdhocPaymentCompletion,
  getPaymentHistory,
  getPaymentById,
  canAccessPaymentRecord,
  getUserPaymentHistory,
  getInvoiceData,
  verifyWebhookSignature,
  verifyGoatWebhookSignature,
  computeInitialDepositPricing,
  isJointAllocationSeat,
  isFullDepositSeatRow,
  undoExperiencePayment,
  attachExperiencePaymentUndoFields,
  findLatestCompletedExperiencePayment,
  // Phase 2: Card Tokenization
  tokenizeAndSaveCard,
  chargeSavedCard,
  removeSavedCard,
  setDefaultPaymentMethod,
  updateSavedCard,
  getCustomerDisplayName,
  ensureGoatCustomerId,
  detectCardBrand,
};

