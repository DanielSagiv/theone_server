const mongoose = require('mongoose');

/**
 * COE History schema
 * @description Stores audit trail incidents for COE changes
 */
const COEHistoryChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true }, // e.g. status, event, seat, deposit_percent
    label: { type: String, required: true }, // Human-friendly label for UI
    from: { type: mongoose.Schema.Types.Mixed },
    to: { type: mongoose.Schema.Types.Mixed },
    message: { type: String, trim: true }, // Preformatted description for detail view
  },
  { _id: false }
);

const COEHistorySchema = new mongoose.Schema(
  {
    coe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'COE',
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    changed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    changed_by_role: {
      type: String,
      enum: ['admin', 'client', 'runner', 'system'],
      required: true,
      index: true,
    },
    current_status: {
      type: String,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    changes: {
      type: [COEHistoryChangeSchema],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for common query pattern
COEHistorySchema.index({ coe_id: 1, timestamp: -1 });

module.exports = mongoose.model('COEHistory', COEHistorySchema);

