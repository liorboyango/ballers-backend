/**
 * Cart Model
 * Represents a user's shopping cart.
 * Each cart item includes product reference, quantity, and customization.
 */
const mongoose = require('mongoose');
const { VALID_SIZES } = require('../utils/constants');

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
      max: [10, 'Maximum quantity per item is 10'],
      default: 1,
    },
    customization: {
      size: {
        type: String,
        enum: VALID_SIZES,
        required: [true, 'Size is required'],
      },
      playerName: {
        type: String,
        trim: true,
        maxlength: [20, 'Player name cannot exceed 20 characters'],
        default: '',
      },
      playerNumber: {
        type: Number,
        min: [1, 'Player number must be between 1 and 99'],
        max: [99, 'Player number must be between 1 and 99'],
        default: null,
      },
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true, // One cart per user
    },
    items: [cartItemSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

// Index for fast user cart lookups
cartSchema.index({ user: 1 });

module.exports = mongoose.model('Cart', cartSchema);
