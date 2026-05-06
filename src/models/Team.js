/**
 * Team Model
 *
 * Represents a World Cup soccer team.
 * Each team can have multiple products (kits) associated with it.
 */

const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    /** Full official name of the team (e.g. "Brazil") */
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'Team name cannot exceed 100 characters'],
    },

    /** ISO 3166-1 alpha-2 country code (e.g. "BR") */
    countryCode: {
      type: String,
      required: [true, 'Country code is required'],
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{2,3}$/, 'Country code must be 2-3 uppercase letters'],
    },

    /** URL or path to the team flag image */
    flagImage: {
      type: String,
      trim: true,
      default: '',
    },

    /** World Cup group (e.g. "A", "B", ...) */
    group: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [2, 'Group cannot exceed 2 characters'],
      default: '',
    },

    /** Short description or tagline for the team */
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },

    /** Whether the team is currently active / visible in the store */
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

/* ------------------------------------------------------------------ */
/* Virtuals                                                             */
/* ------------------------------------------------------------------ */

/**
 * Virtual: products
 * Allows population of all products belonging to this team.
 */
teamSchema.virtual('products', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'team',
});

/* ------------------------------------------------------------------ */
/* Indexes                                                              */
/* ------------------------------------------------------------------ */

teamSchema.index({ name: 1 });
teamSchema.index({ countryCode: 1 });
teamSchema.index({ group: 1 });
teamSchema.index({ isActive: 1 });

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

module.exports = mongoose.model('Team', teamSchema);
