const crypto = require('crypto');
const COE = require('../models/COE');
const ProposalGroup = require('../models/ProposalGroup');
const User = require('../models/User');

/** COE statuses eligible for payment-window expiry (draft/request excluded). */
const PAYABLE_FOR_PROPOSAL_TIMER = ['approved', 'accepted_not_paid', 'pending_pay'];

const MAX_PROPOSAL_PAYMENT_DEADLINE_HOURS = 720;

/**
 * Count COEs in a proposal group (any client; same group id).
 * @param {string} proposalGroupId
 * @returns {Promise<number>}
 */
async function countMembersInGroup(proposalGroupId) {
  const gid = String(proposalGroupId || '').trim();
  if (!gid) return 0;
  return COE.countDocuments({ proposal_group_id: gid });
}

/**
 * Ensure admin owns at least one COE in the group; return ProposalGroup doc.
 * @param {string} proposalGroupId
 * @param {string} adminUserId
 * @returns {Promise<import('mongoose').Document>}
 */
async function assertAdminOwnsOpenGroup(proposalGroupId, adminUserId) {
  const gid = String(proposalGroupId || '').trim();
  if (!gid) {
    throw new Error('proposalGroupId is required');
  }
  const group = await ProposalGroup.findOne({ proposal_group_id: gid });
  if (!group) {
    throw new Error('Proposal group not found');
  }
  if (group.status !== 'open') {
    throw new Error('Proposal group is not open');
  }
  const admin = await User.findById(adminUserId);
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin only');
  }
  const ownsGroupCoe = await COE.exists({
    proposal_group_id: gid,
    admin_id: adminUserId,
  });
  if (!ownsGroupCoe) {
    throw new Error('Forbidden');
  }
  return group;
}

/**
 * Mirror ProposalGroup payment timer onto every member COE (or clear all).
 * @param {string} proposalGroupId
 * @returns {Promise<void>}
 */
async function syncProposalGroupPaymentDeadlineToMembers(proposalGroupId) {
  const gid = String(proposalGroupId || '').trim();
  if (!gid) return;
  const group = await ProposalGroup.findOne({ proposal_group_id: gid });
  if (!group) return;

  const at = group.proposal_payment_deadline_at;
  const hours = group.proposal_payment_deadline_hours;

  if (at != null && typeof hours === 'number' && hours > 0) {
    await COE.updateMany(
      { proposal_group_id: gid },
      {
        $set: {
          payment_deadline_at: at,
          payment_deadline_hours: hours,
        },
      },
    );
  } else {
    await COE.updateMany(
      { proposal_group_id: gid },
      { $unset: { payment_deadline_at: 1, payment_deadline_hours: 1 } },
    );
  }
}

/**
 * Validate hours for group proposal timer (must be 1..720).
 * @param {unknown} hours
 * @returns {number}
 */
function parseProposalTimerHours(hours) {
  const n = typeof hours === 'number' ? hours : Number(hours);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PROPOSAL_PAYMENT_DEADLINE_HOURS) {
    throw new Error(
      `payment_deadline_hours must be between 1 and ${MAX_PROPOSAL_PAYMENT_DEADLINE_HOURS}`,
    );
  }
  return n;
}

/**
 * Start or reset group payment timer from now (multi-member groups only).
 * @param {string} proposalGroupId
 * @param {string} adminUserId
 * @param {number} paymentDeadlineHours
 * @returns {Promise<{ proposal_payment_deadline_at: Date, proposal_payment_deadline_hours: number }>}
 */
async function startProposalGroupTimer(proposalGroupId, adminUserId, paymentDeadlineHours) {
  const hours = parseProposalTimerHours(paymentDeadlineHours);
  const n = await countMembersInGroup(proposalGroupId);
  if (n < 2) {
    throw new Error('Proposal group timer requires at least two experiences in the group');
  }
  const group = await assertAdminOwnsOpenGroup(proposalGroupId, adminUserId);
  const now = new Date();
  const deadlineMs = now.getTime() + hours * 60 * 60 * 1000;
  group.proposal_payment_deadline_hours = hours;
  group.proposal_payment_deadline_at = new Date(deadlineMs);
  await group.save();
  await syncProposalGroupPaymentDeadlineToMembers(proposalGroupId);
  return {
    proposal_payment_deadline_at: group.proposal_payment_deadline_at,
    proposal_payment_deadline_hours: group.proposal_payment_deadline_hours,
  };
}

/**
 * Clear canonical group timer and remove mirrored deadlines from all members.
 * @param {string} proposalGroupId
 * @param {string} adminUserId
 * @returns {Promise<void>}
 */
async function cancelProposalGroupTimer(proposalGroupId, adminUserId) {
  await assertAdminOwnsOpenGroup(proposalGroupId, adminUserId);
  await ProposalGroup.updateOne(
    { proposal_group_id: String(proposalGroupId).trim() },
    {
      $set: {
        proposal_payment_deadline_at: null,
        proposal_payment_deadline_hours: null,
      },
    },
  );
  await syncProposalGroupPaymentDeadlineToMembers(proposalGroupId);
}

/**
 * Same as start (new window from now).
 * @param {string} proposalGroupId
 * @param {string} adminUserId
 * @param {number} paymentDeadlineHours
 */
async function resetProposalGroupTimer(proposalGroupId, adminUserId, paymentDeadlineHours) {
  return startProposalGroupTimer(proposalGroupId, adminUserId, paymentDeadlineHours);
}

/**
 * Expire all payable members; skip draft/request. Then clear group timer + member deadlines.
 * @param {string} proposalGroupId
 * @param {string|null} adminUserId - null for system/cron
 * @param {{ suppressNotifications?: boolean }} [opts]
 * @returns {Promise<{ expired: number }>}
 */
async function expireAllProposalsInGroup(proposalGroupId, adminUserId, opts = {}) {
  const gid = String(proposalGroupId || '').trim();
  if (!gid) {
    throw new Error('proposalGroupId is required');
  }
  const group = await ProposalGroup.findOne({ proposal_group_id: gid });
  if (!group) {
    throw new Error('Proposal group not found');
  }
  if (adminUserId) {
    await assertAdminOwnsOpenGroup(gid, adminUserId);
  }

  const coeService = require('./coeService');
  const suppressNotifications = opts.suppressNotifications === true;
  const members = await COE.find({
    proposal_group_id: gid,
    status: { $in: PAYABLE_FOR_PROPOSAL_TIMER },
  }).select('_id status');

  let expired = 0;
  for (const m of members) {
    try {
      await coeService.updateCOEStatus(m._id.toString(), 'expired', adminUserId, {
        skipMultiProposalResolution: true,
        suppressNotifications,
      });
      expired += 1;
    } catch (e) {
      console.error('[proposalGroupService] expire member failed:', m._id?.toString(), e.message);
    }
  }

  await ProposalGroup.updateOne(
    { proposal_group_id: gid },
    {
      $set: {
        proposal_payment_deadline_at: null,
        proposal_payment_deadline_hours: null,
      },
    },
  );
  await syncProposalGroupPaymentDeadlineToMembers(gid);

  return { expired };
}

/**
 * Cron: open groups whose canonical deadline passed — expire payable members and clear timer.
 * @returns {Promise<number>} Groups processed
 */
async function expireOverdueProposalGroups() {
  const now = new Date();
  const groups = await ProposalGroup.find({
    status: 'open',
    proposal_payment_deadline_at: { $lte: now },
  })
    .select('proposal_group_id')
    .lean();

  let processed = 0;
  for (const g of groups) {
    if (!g.proposal_group_id) continue;
    try {
      await expireAllProposalsInGroup(g.proposal_group_id, null, { suppressNotifications: true });
      processed += 1;
    } catch (e) {
      console.error('[proposalGroupService] expireOverdueProposalGroups:', g.proposal_group_id, e.message);
    }
  }
  return processed;
}

/**
 * Apply canonical group timer to a plain COE object (e.g. new draft), or clear inherited deadlines.
 * @param {object} plain - Mutable plain object for new COE
 * @param {string} proposalGroupId
 */
async function applyGroupProposalTimerToPlain(plain, proposalGroupId) {
  const gid = String(proposalGroupId || '').trim();
  if (!gid) return;
  const group = await ProposalGroup.findOne({ proposal_group_id: gid }).lean();
  plain.payment_deadline_at = undefined;
  plain.payment_deadline_hours = undefined;
  if (
    group &&
    group.proposal_payment_deadline_at &&
    typeof group.proposal_payment_deadline_hours === 'number' &&
    group.proposal_payment_deadline_hours > 0
  ) {
    plain.payment_deadline_at = new Date(group.proposal_payment_deadline_at);
    plain.payment_deadline_hours = group.proposal_payment_deadline_hours;
  }
}

/**
 * Count approved client-visible options in a proposal group (same client).
 * @param {string} proposalGroupId
 * @param {import('mongoose').Types.ObjectId} clientId
 * @returns {Promise<number>}
 */
async function countApprovedMembers(proposalGroupId, clientId) {
  return COE.countDocuments({
    proposal_group_id: proposalGroupId,
    client_id: clientId,
    status: 'approved',
  });
}

/**
 * Client may POST /accept without 100% deposit when choosing among N>=2 approved options in an open group.
 * @param {object} coe - COE plain object or document (needs proposal_group_id, client_id)
 * @returns {Promise<boolean>}
 */
async function clientMayChooseWithoutFullDeposit(coe) {
  const proposalGroupId = coe?.proposal_group_id;
  if (!proposalGroupId || !coe?.client_id) return false;
  const gid = String(proposalGroupId).trim();
  if (!gid) return false;

  const group = await ProposalGroup.findOne({ proposal_group_id: gid });
  if (!group || group.status !== 'open') return false;

  const clientId = coe.client_id._id || coe.client_id;
  const n = await countApprovedMembers(gid, clientId);
  return n >= 2;
}

/**
 * Set proposal_label from creation order (1-based) when missing and group has 2+ COEs for this client.
 * @param {import('mongoose').Document|object} coe - Must have _id, proposal_group_id, client_id
 * @returns {Promise<string|null>} Assigned label or null
 */
async function ensureProposalOptionLabelIfMissing(coe) {
  const gidRaw = coe?.proposal_group_id;
  if (!gidRaw || !coe?.client_id || !coe?._id) return null;
  const gid = String(gidRaw).trim();
  if (!gid) return null;

  if (coe.proposal_label != null && String(coe.proposal_label).trim() !== '') {
    return String(coe.proposal_label).trim();
  }

  const clientId = coe.client_id._id || coe.client_id;
  const total = await COE.countDocuments({ proposal_group_id: gid, client_id: clientId });
  if (total < 2) return null;

  const peers = await COE.find({ proposal_group_id: gid, client_id: clientId })
    .sort({ created_at: 1 })
    .select('_id')
    .lean();
  const idx = peers.findIndex((p) => p._id.toString() === coe._id.toString()) + 1;
  if (idx < 1) return null;
  const label = String(idx);
  await COE.updateOne({ _id: coe._id }, { $set: { proposal_label: label } });
  if (typeof coe.set === 'function') {
    coe.set('proposal_label', label);
  } else {
    coe.proposal_label = label;
  }
  return label;
}

/**
 * When the client (or admin) commits to one COE from approved — accept, pay deposit, or full pay —
 * cancel other approved siblings, mark ProposalGroup resolved. Does not change the winner COE status;
 * caller continues with a single updateCOEStatus for pending_pay / paid / accepted_not_paid.
 * Idempotent if group already resolved with this COE as chosen.
 * @param {import('../models/COE')} coe - Mongoose COE document (pre-transition, status approved)
 * @param {string|null|undefined} actingUserId - Client/admin user; null for system (webhooks)
 * @returns {Promise<void>}
 */
async function prepareOpenProposalGroupForApprovedWinner(coe, actingUserId) {
  const proposalGroupId = coe.proposal_group_id;
  if (!proposalGroupId) return;

  const group = await ProposalGroup.findOne({ proposal_group_id: proposalGroupId });
  if (!group) return;

  if (group.status === 'resolved') {
    const chosen = group.chosen_coe_id?.toString();
    const thisId = coe._id.toString();
    if (chosen && chosen !== thisId) {
      throw new Error('Another option was already chosen for this proposal set');
    }
    return;
  }

  const approvedCount = await countApprovedMembers(proposalGroupId, coe.client_id);
  if (approvedCount < 2) {
    group.status = 'resolved';
    group.chosen_coe_id = coe._id;
    group.resolved_at = new Date();
    await group.save();
    return;
  }

  await ensureProposalOptionLabelIfMissing(coe);

  const coeService = require('./coeService');
  const losers = await COE.find({
    proposal_group_id: proposalGroupId,
    client_id: coe.client_id,
    status: 'approved',
    _id: { $ne: coe._id },
  }).select('_id');

  for (const loser of losers) {
    await coeService.updateCOEStatus(loser._id.toString(), 'cancelled', actingUserId, {
      skipMultiProposalResolution: true,
      suppressNotifications: true,
    });
  }

  group.status = 'resolved';
  group.chosen_coe_id = coe._id;
  group.resolved_at = new Date();
  await group.save();
}

/**
 * Legacy hook: only prepares group; winner status is updated by the caller (coeService.updateCOEStatus).
 * @param {import('../models/COE')} coe
 * @param {string|null|undefined} actingUserId
 * @returns {Promise<null>}
 */
async function handleAcceptInOpenGroup(coe, actingUserId) {
  await prepareOpenProposalGroupForApprovedWinner(coe, actingUserId);
  return null;
}

/**
 * Send grouped proposal push + in-app notification (design doc copy).
 * @param {string} clientUserId
 * @param {string} proposalGroupId
 * @param {number} n
 */
async function notifyClientGroupedProposalsReady(clientUserId, proposalGroupId, n) {
  const notificationService = require('./notificationService');
  try {
    await notificationService.createAndSendNotification(clientUserId, 'proposal_group_ready', {
      proposal_group_id: proposalGroupId,
      proposal_count: n,
    });
  } catch (err) {
    console.error('[proposalGroupService] notifyClientGroupedProposalsReady failed:', err.message);
  }
}

/**
 * Publish all draft/request COEs in the group to approved; one grouped client notification.
 * @param {string} proposalGroupId
 * @param {string} adminUserId
 * @returns {Promise<{ updated: number, group: object }>}
 */
async function publishProposalGroup(proposalGroupId, adminUserId) {
  const group = await ProposalGroup.findOne({ proposal_group_id: proposalGroupId });
  if (!group) {
    throw new Error('Proposal group not found');
  }
  if (group.status !== 'open') {
    throw new Error('Proposal group is not open');
  }

  const admin = await User.findById(adminUserId);
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin only');
  }

  const ownsGroupCoe = await COE.exists({
    proposal_group_id: proposalGroupId,
    admin_id: adminUserId,
  });
  if (!ownsGroupCoe) {
    throw new Error('Forbidden');
  }

  const members = await COE.find({ proposal_group_id: proposalGroupId });
  if (members.length === 0) {
    throw new Error('No COEs in this proposal group');
  }

  const clientId = members[0].client_id.toString();
  if (!members.every((m) => m.client_id.toString() === clientId)) {
    throw new Error('All COEs in a proposal group must belong to the same client');
  }

  const coeService = require('./coeService');
  let updated = 0;
  for (const c of members) {
    if (c.status === 'draft' || c.status === 'request') {
      await coeService.updateCOEStatus(c._id.toString(), 'approved', adminUserId, {
        skipMultiProposalResolution: true,
        suppressNotifications: true,
      });
      updated += 1;
    }
  }

  const n = await countApprovedMembers(proposalGroupId, members[0].client_id);
  if (n >= 2) {
    await notifyClientGroupedProposalsReady(clientId, proposalGroupId, n);
  }

  return { updated, group, approved_count: n };
}

/**
 * Duplicate current COE as a sibling draft; create ProposalGroup if source was solo (design §7.1).
 * @param {string} sourceCoeId
 * @param {string} adminUserId
 * @returns {Promise<object>} New COE (lean or mongoose doc from getCOEById)
 */
async function duplicateCoeAsProposal(sourceCoeId, adminUserId) {
  const source = await COE.findById(sourceCoeId);
  if (!source) {
    throw new Error('COE not found');
  }
  const admin = await User.findById(adminUserId);
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin only');
  }

  const srcAdmin = source.admin_id?.toString?.() || String(source.admin_id);
  if (String(adminUserId) !== String(srcAdmin)) {
    throw new Error('Forbidden');
  }

  const plain = source.toObject({ depopulate: true });
  delete plain._id;
  delete plain.__v;
  delete plain.createdAt;
  delete plain.updatedAt;

  (plain.events || []).forEach((e) => {
    delete e._id;
    delete e.coe_id;
  });
  (plain.selected_seats || []).forEach((s) => {
    delete s._id;
    delete s.coe_id;
  });

  let gid = source.proposal_group_id || null;
  if (!gid) {
    gid = crypto.randomUUID();
    source.proposal_group_id = gid;
    await ProposalGroup.create({
      proposal_group_id: gid,
      client_id: source.client_id,
      admin_id: source.admin_id,
      created_by: adminUserId,
      status: 'open',
    });
    await source.save();
  }

  plain.proposal_group_id = gid;

  /** Strip "(copy)" and a trailing " N" when N matches source.proposal_label (indexed siblings). */
  const srcLabel =
    source.proposal_label != null && String(source.proposal_label).trim() !== ''
      ? String(source.proposal_label).trim()
      : '';
  let baseName = (plain.name || 'Experience').replace(/\s*\(copy\)\s*$/i, '').trim();
  if (srcLabel && /^\d+$/.test(srcLabel)) {
    const re = new RegExp(`\\s+${srcLabel}$`);
    if (re.test(baseName)) baseName = baseName.replace(re, '').trim();
  }
  if (!baseName) baseName = 'Experience';

  const existingInGroup = await COE.countDocuments({ proposal_group_id: gid });
  const proposalIndex = existingInGroup + 1;
  plain.name = `${baseName} ${proposalIndex}`.slice(0, 200);
  plain.proposal_label = String(proposalIndex);

  plain.status = 'draft';
  plain.payment_status = 'unpaid';
  plain.payment_id = null;
  plain.deposit_paid_at = null;
  plain.deposit_payment_id = null;
  plain.final_paid_at = null;
  plain.final_payment_id = null;
  plain.total_paid = 0;
  plain.revision_state = 'none';
  plain.revision_base_snapshot = null;
  plain.revision_case = null;
  plain.approved_date = null;
  plain.paid_date = null;
  plain.accepted_date = null;
  plain.pending_pay_date = null;
  plain.created_by = adminUserId;

  await applyGroupProposalTimerToPlain(plain, gid);

  const dup = new COE(plain);
  await dup.save();

  if (dup.events && dup.events.length > 0) {
    dup.events.forEach((ev) => {
      ev.coe_id = dup._id;
    });
  }
  if (dup.selected_seats && dup.selected_seats.length > 0) {
    dup.selected_seats.forEach((seat) => {
      seat.coe_id = dup._id;
      if (!seat.status) seat.status = 'selected';
    });
  }
  await dup.save();

  const approvedN = await countApprovedMembers(gid, dup.client_id);
  if (approvedN >= 2) {
    await notifyClientGroupedProposalsReady(dup.client_id.toString(), gid, approvedN);
  }

  const coeService = require('./coeService');
  return coeService.getCOEById(dup._id.toString());
}

/**
 * Load member COEs for picker; client sees own, admin may pass clientId query to view client's group.
 * @param {string} proposalGroupId
 * @param {object} opts
 * @param {string} opts.userId - acting user
 * @param {string} [opts.role] - user role
 * @param {string} [opts.clientId] - admin: optional explicit client
 * @returns {Promise<object[]>}
 */
async function listMembersForUser(proposalGroupId, opts) {
  const { userId, role, clientId: adminClientId } = opts;
  const group = await ProposalGroup.findOne({ proposal_group_id: proposalGroupId });
  if (!group) {
    throw new Error('Proposal group not found');
  }

  if (role === 'admin') {
    const owns = await COE.exists({
      proposal_group_id: proposalGroupId,
      admin_id: userId,
    });
    if (!owns) {
      throw new Error('Forbidden');
    }
    if (adminClientId && adminClientId !== group.client_id.toString()) {
      throw new Error('Client does not match proposal group');
    }
  } else if (userId !== group.client_id.toString()) {
    throw new Error('Forbidden');
  }

  const memberQuery = {
    proposal_group_id: proposalGroupId,
    client_id: group.client_id,
  };
  if (role !== 'admin') {
    memberQuery.status = { $ne: 'cancelled' };
  }

  const list = await COE.find(memberQuery)
    .sort({ updated_at: -1 })
    .populate('client_id', 'firstName lastName email role')
    .populate('admin_id', 'firstName lastName email role');

  return list;
}

module.exports = {
  prepareOpenProposalGroupForApprovedWinner,
  handleAcceptInOpenGroup,
  publishProposalGroup,
  duplicateCoeAsProposal,
  listMembersForUser,
  countApprovedMembers,
  countMembersInGroup,
  clientMayChooseWithoutFullDeposit,
  ensureProposalOptionLabelIfMissing,
  syncProposalGroupPaymentDeadlineToMembers,
  startProposalGroupTimer,
  cancelProposalGroupTimer,
  resetProposalGroupTimer,
  expireAllProposalsInGroup,
  expireOverdueProposalGroups,
  MAX_PROPOSAL_PAYMENT_DEADLINE_HOURS,
};
