const mongoose = require('mongoose');

/**
 * ProposalGroup — canonical lifecycle for multi-COE proposal sets (MULTIPLE-COE-PROPOSALS-DESIGN.md).
 * `proposal_group_id` string is also stored on each member COE for queries.
 */
const proposalGroupSchema = new mongoose.Schema(
  {
    proposal_group_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      index: true,
    },
    chosen_coe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'COE',
      default: null,
    },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProposalGroup', proposalGroupSchema);
