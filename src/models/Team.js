/**
 * Team Model
 * Represents a World Cup soccer team with flag and group info.
 */

const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      unique: true,
      trim: true,
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
    },
    flagUrl: {
      type: String,
      default: '',
    },
    group: {
      type: String,
      trim: true,
    },
    confederation: {
      type: String,
      enum: ['UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'],
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: count of products for this team
teamSchema.virtual('products', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'team',
  count: true,
});

// Index for fast lookups
teamSchema.index({ name: 1 });
teamSchema.index({ group: 1 });

const Team = mongoose.model('Team', teamSchema);
module.exports = Team;
