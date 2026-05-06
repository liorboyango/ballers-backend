/**
 * Order Model
 *
 * Represents a completed purchase by a user.
 * Stores a snapshot of the ordered items (including customization),
 * shipping address, masked payment info, and pricing breakdown.
 */

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** Snapshot of a single ordered item */
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    /** Denormalised product name (preserved even if product is deleted) */
    name: { type: String, required: true, trim: true },
    /** URL of the primary product image at time of purchase */
    image: { type: String, default: '' },
    /** Unit price at time of purchase */
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    customization: {
      playerName: { type: String, trim: true, default: '' },
      playerNumber: { type: String, trim: true, default: '' },
      size: {
        type: String,
        enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        default: 'M',
      },
    },
  },
  { _id: false }
);

/** Shipping address snapshot */
const shippingAddressSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    zip: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/** Masked payment info (no sensitive data stored) */
const paymentInfoSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ['card', 'paypal'],
      default: 'card',
    },
    /** Last 4 digits of the card number */
    last4: { type: String, default: '' },
    cardHolder: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main Order schema
// ---------------------------------------------------------------------------

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'An order must contain at least one item.',
      },
    },
    shippingAddress: { type: shippingAddressSchema, required: true },
    paymentInfo: { type: paymentInfoSchema, required: true },

    /** Pricing breakdown */
    subtotal: { type: Number, required: true, min: 0 },
    shippingCost: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    /**
     * Order lifecycle status.
     * pending   -> confirmed -> processing -> shipped -> delivered
     *                                                 -> cancelled
     */
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },

    /** Optional tracking number provided after shipment */
    trackingNumber: { type: String, trim: true, default: '' },

    /** Admin notes (internal use) */
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
    versionKey: false,
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Compound index for efficient user order history queries
orderSchema.index({ user: 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/** Human-readable order reference (e.g. ORD-507f1f77bcf86cd799439011) */
orderSchema.virtual('orderRef').get(function () {
  return `ORD-${this._id}`;
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = mongoose.model('Order', orderSchema);
