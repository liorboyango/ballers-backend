/**
 * Product Model
 * Represents a soccer team kit with customization options (number, name, sponsor).
 */

const mongoose = require('mongoose');
const { KIT_TYPES, SIZES } = require('../utils/constants');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Team reference is required'],
      index: true,
    },
    kitType: {
      type: String,
      enum: KIT_TYPES,
      required: [true, 'Kit type is required'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    images: [
      {
        url: { type: String, required: true },
        alt: { type: String, default: '' },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    sizes: {
      type: [String],
      enum: SIZES,
      default: SIZES,
    },
    stock: {
      type: Map,
      of: Number,
      default: () => {
        const s = {};
        SIZES.forEach((size) => { s[size] = 100; });
        return s;
      },
    },
    customization: {
      allowNumber: { type: Boolean, default: true },
      allowName: { type: Boolean, default: true },
      allowSponsor: { type: Boolean, default: false },
      defaultNumber: { type: String, default: '' },
      defaultName: { type: String, default: '' },
    },
    tags: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    season: { type: String, default: '2026' },
  },
  {
    timestamps: true,
  }
);

// Compound index for team + kitType queries
productSchema.index({ team: 1, kitType: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
