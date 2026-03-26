const crypto = require('crypto');
const COE = require('../models/COE');
const ProposalGroup = require('../models/ProposalGroup');
const User = require('../models/User');

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
 * Before normal approved→accepted_not_paid transition: resolve open multi-proposal groups.
 * @param {import('../models/COE')} coe - Mongoose COE document (pre-transition)
 * @param {string} actingUserId
 * @returns {Promise<object|null>} getCOEById result if this handler completed accept; null to continue normal path
 */
async function handleAcceptInOpenGroup(coe, actingUserId) {
  const proposalGroupId = coe.proposal_group_id;
  if (!proposalGroupId) return null;

  const group = await ProposalGroup.findOne({ proposal_group_id: proposalGroupId });
  if (!group) return null;

  if (group.status === 'resolved') {
    const chosen = group.chosen_coe_id?.toString();
    const thisId = coe._id.toString();
    if (chosen && chosen !== thisId) {
      throw new Error('Another option was already chosen for this proposal set');
    }
    return null;
  }

  const approvedCount = await countApprovedMembers(proposalGroupId, coe.client_id);
  if (approvedCount < 2) {
    group.status = 'resolved';
    group.chosen_coe_id = coe._id;
    group.resolved_at = new Date();
    await group.save();
    return null;
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

  return coeService.updateCOEStatus(coe._id.toString(), 'accepted_not_paid', actingUserId, {
    skipMultiProposalResolution: true,
  });
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

  const list = await COE.find({
    proposal_group_id: proposalGroupId,
    client_id: group.client_id,
  })
    .sort({ updated_at: -1 })
    .populate('client_id', 'firstName lastName email role')
    .populate('admin_id', 'firstName lastName email role');

  return list;
}

module.exports = {
  handleAcceptInOpenGroup,
  publishProposalGroup,
  duplicateCoeAsProposal,
  listMembersForUser,
  countApprovedMembers,
  clientMayChooseWithoutFullDeposit,
  ensureProposalOptionLabelIfMissing,
};
