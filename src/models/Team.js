/**
 * Team Model
 * Represents a World Cup participating nation.
 */
const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      maxlength: [100, 'Team name cannot exceed 100 characters'],
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
    },
    countryCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [3, 'Country code cannot exceed 3 characters'],
    },
    group: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [2, 'Group cannot exceed 2 characters'],
    },
    flagUrl: {
      type: String,
      trim: true,
    },
    confederation: {
      type: String,
      enum: ['UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'],
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

// Index for fast name/country lookups
teamSchema.index({ name: 1 });
teamSchema.index({ country: 1 });
teamSchema.index({ group: 1 });

module.exports = mongoose.model('Team', teamSchema);
