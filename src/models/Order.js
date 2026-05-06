/**
 * Order Model
 *
 * Represents a completed purchase.
 * Stores a snapshot of all items, pricing, shipping address,
 * and payment information at the time of checkout.
 */

const mongoose = require('mongoose');

/* ------------------------------------------------------------------ */
/* Sub-schemas                                                          */
/* ------------------------------------------------------------------ */

/** Snapshot of customization chosen at checkout */
const orderItemCustomizationSchema = new mongoose.Schema(
  {
    playerName: { type: String, trim: true, default: '' },
    jerseyNumber: { type: Number, default: null },
    sponsor: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/** Snapshot of a single line item at the time of purchase */
const orderItemSchema = new mongoose.Schema(
  {
    /** Reference to the original Product (for admin / re-order) */
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Order item must reference a product'],
    },

    /** Snapshot of the product name at purchase time */
    productName: {
      type: String,
      required: [true, 'Product name snapshot is required'],
      trim: true,
    },

    /** Snapshot of the product thumbnail at purchase time */
    productThumbnail: {
      type: String,
      trim: true,
      default: '',
    },

    /** Chosen size */
    size: {
      type: String,
      required: [true, 'Size is required'],
      enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    },

    /** Quantity purchased */
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },

    /** Unit price at the time of purchase */
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required'],
      min: [0, 'Unit price cannot be negative'],
    },

    /** Customization details */
    customization: {
      type: orderItemCustomizationSchema,
      default: () => ({}),
    },
  },
  {
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** Virtual: lineTotal */
orderItemSchema.virtual('lineTotal').get(function () {
  return this.quantity * this.unitPrice;
});

/** Shipping address snapshot */
const shippingAddressSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, required: true },
    lastName: { type: String, trim: true, required: true },
    addressLine1: { type: String, trim: true, required: true },
    addressLine2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, required: true },
    state: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, required: true },
    country: { type: String, trim: true, required: true },
    phone: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/** Payment information snapshot (no raw card data — store only safe metadata) */
const paymentInfoSchema = new mongoose.Schema(
  {
    /** Payment method type */
    method: {
      type: String,
      enum: ['card', 'paypal', 'stripe', 'other'],
      default: 'card',
    },

    /** Last 4 digits of the card (safe to store) */
    last4: {
      type: String,
      trim: true,
      default: '',
    },

    /** Card brand (e.g. "Visa", "Mastercard") */
    brand: {
      type: String,
      trim: true,
      default: '',
    },

    /** External payment provider transaction ID */
    transactionId: {
      type: String,
      trim: true,
      default: '',
    },

    /** Payment status */
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },

    /** Timestamp when payment was confirmed */
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

/* ------------------------------------------------------------------ */
/* Order schema                                                         */
/* ------------------------------------------------------------------ */

const orderSchema = new mongoose.Schema(
  {
    /** Human-readable order number (e.g. "ORD-20260506-0001") */
    orderNumber: {
      type: String,
      unique: true,
      trim: true,
    },

    /** The customer who placed the order */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Order must belong to a user'],
      index: true,
    },

    /** Snapshot of the customer email at order time */
    email: {
      type: String,
      required: [true, 'Customer email is required'],
      trim: true,
      lowercase: true,
    },

    /** Line items */
    items: {
      type: [orderItemSchema],
      required: [true, 'Order must have at least one item'],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Order must contain at least one item',
      },
    },

    /** Shipping address snapshot */
    shippingAddress: {
      type: shippingAddressSchema,
      required: [true, 'Shipping address is required'],
    },

    /** Payment information */
    payment: {
      type: paymentInfoSchema,
      default: () => ({}),
    },

    /** Order lifecycle status */
    status: {
      type: String,
      enum: {
        values: [
          'pending',
          'confirmed',
          'processing',
          'shipped',
          'delivered',
          'cancelled',
          'refunded',
        ],
        message:
          'Status must be one of: pending, confirmed, processing, shipped, delivered, cancelled, refunded',
      },
      default: 'pending',
    },

    /** Subtotal before discount and shipping */
    subtotal: {
      type: Number,
      required: [true, 'Subtotal is required'],
      min: [0, 'Subtotal cannot be negative'],
    },

    /** Shipping cost */
    shippingCost: {
      type: Number,
      default: 0,
      min: [0, 'Shipping cost cannot be negative'],
    },

    /** Discount amount applied */
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, 'Discount amount cannot be negative'],
    },

    /** Coupon code used */
    couponCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    /** Tax amount */
    taxAmount: {
      type: Number,
      default: 0,
      min: [0, 'Tax amount cannot be negative'],
    },

    /** Grand total (subtotal + shipping + tax - discount) */
    total: {
      type: Number,
      required: [true, 'Total is required'],
      min: [0, 'Total cannot be negative'],
    },

    /** Tracking number provided by the shipping carrier */
    trackingNumber: {
      type: String,
      trim: true,
      default: null,
    },

    /** Carrier name (e.g. "FedEx", "UPS") */
    carrier: {
      type: String,
      trim: true,
      default: null,
    },

    /** Internal notes (admin only) */
    notes: {
      type: String,
      trim: true,
      default: '',
    },

    /** Timestamp when the order was shipped */
    shippedAt: {
      type: Date,
      default: null,
    },

    /** Timestamp when the order was delivered */
    deliveredAt: {
      type: Date,
      default: null,
    },

    /** Timestamp when the order was cancelled */
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* ------------------------------------------------------------------ */
/* Pre-save hook — generate order number                               */
/* ------------------------------------------------------------------ */

orderSchema.pre('save', async function (next) {
  if (this.isNew && !this.orderNumber) {
    try {
      const date = new Date();
      const datePart = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('');

      // Count existing orders today to generate a sequential suffix
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      const count = await this.constructor.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      });

      this.orderNumber = `ORD-${datePart}-${String(count + 1).padStart(4, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

/* ------------------------------------------------------------------ */
/* Indexes                                                              */
/* ------------------------------------------------------------------ */

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ status: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ createdAt: -1 });

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

module.exports = mongoose.model('Order', orderSchema);
