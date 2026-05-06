/**
 * Cart Model
 *
 * Represents a shopping cart for a user (or a guest session).
 * Each cart item references a Product and stores the chosen
 * customization (name, number, sponsor) and size.
 */

const mongoose = require('mongoose');

/* ------------------------------------------------------------------ */
/* CartItem sub-schema                                                  */
/* ------------------------------------------------------------------ */

const cartItemCustomizationSchema = new mongoose.Schema(
  {
    /** Custom player name printed on the kit */
    playerName: {
      type: String,
      trim: true,
      maxlength: [30, 'Player name cannot exceed 30 characters'],
      default: '',
    },

    /** Jersey number printed on the kit */
    jerseyNumber: {
      type: Number,
      min: [1, 'Jersey number must be at least 1'],
      max: [99, 'Jersey number cannot exceed 99'],
      default: null,
    },

    /** Chosen sponsor identifier / image URL */
    sponsor: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const cartItemSchema = new mongoose.Schema(
  {
    /** Reference to the Product */
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Cart item must reference a product'],
    },

    /** Chosen size (XS, S, M, L, XL, XXL) */
    size: {
      type: String,
      required: [true, 'Size is required'],
      enum: {
        values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        message: 'Size must be one of: XS, S, M, L, XL, XXL',
      },
    },

    /** Quantity of this item */
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
      max: [10, 'Cannot add more than 10 of the same item'],
      default: 1,
    },

    /** Unit price at the time the item was added (snapshot) */
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required'],
      min: [0, 'Unit price cannot be negative'],
    },

    /** Customization details chosen by the customer */
    customization: {
      type: cartItemCustomizationSchema,
      default: () => ({}),
    },
  },
  {
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** Virtual: subtotal — quantity × unitPrice */
cartItemSchema.virtual('subtotal').get(function () {
  return this.quantity * this.unitPrice;
});

/* ------------------------------------------------------------------ */
/* Cart schema                                                          */
/* ------------------------------------------------------------------ */

const cartSchema = new mongoose.Schema(
  {
    /**
     * Owner of the cart.
     * Null for guest carts (identified by sessionId instead).
     */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /**
     * Guest session identifier.
     * Used when the user is not logged in.
     */
    sessionId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    /** Line items in the cart */
    items: {
      type: [cartItemSchema],
      default: [],
    },

    /** Coupon / promo code applied to the cart */
    couponCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    /** Discount amount applied by the coupon */
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, 'Discount amount cannot be negative'],
    },

    /** Whether the cart has been converted to an order */
    isCheckedOut: {
      type: Boolean,
      default: false,
    },

    /** Expiry for guest carts (TTL index) */
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
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

/** Virtual: subtotal — sum of all item subtotals before discount */
cartSchema.virtual('subtotal').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
});

/** Virtual: total — subtotal minus discount */
cartSchema.virtual('total').get(function () {
  return Math.max(0, this.subtotal - (this.discountAmount || 0));
});

/** Virtual: itemCount — total number of individual items */
cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

/* ------------------------------------------------------------------ */
/* Indexes                                                              */
/* ------------------------------------------------------------------ */

cartSchema.index({ user: 1, isCheckedOut: 1 });
cartSchema.index({ sessionId: 1, isCheckedOut: 1 });
// TTL index: automatically remove expired guest carts
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

module.exports = mongoose.model('Cart', cartSchema);
