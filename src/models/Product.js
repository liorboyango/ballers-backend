/**
 * Product Model
 * Represents a soccer kit/jersey available for purchase.
 * Supports customization (player name and number).
 */
const mongoose = require('mongoose');
const { VALID_SIZES, KIT_TYPES } = require('../utils/constants');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [100, 'Product name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Team reference is required'],
    },
    kitType: {
      type: String,
      enum: KIT_TYPES,
      required: [true, 'Kit type is required'],
    },
    sizes: {
      type: [String],
      enum: VALID_SIZES,
      required: [true, 'At least one size is required'],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'At least one size must be provided',
      },
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative'],
    },
    imageUrl: {
      type: String,
      trim: true,
    },
    customizable: {
      type: Boolean,
      default: true,
    },
    sponsor: {
      type: String,
      trim: true,
      maxlength: [50, 'Sponsor name cannot exceed 50 characters'],
    },
    season: {
      type: String,
      trim: true,
      maxlength: [20, 'Season cannot exceed 20 characters'],
    },
    isNew: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

// Indexes for common query patterns
productSchema.index({ team: 1 });
productSchema.index({ kitType: 1 });
productSchema.index({ price: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ name: 'text', description: 'text' }); // Text search

module.exports = mongoose.model('Product', productSchema);
