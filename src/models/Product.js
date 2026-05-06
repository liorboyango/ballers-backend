/**
 * Product Model
 *
 * Represents a soccer kit (T-shirt) available in the store.
 * Supports customization options such as player name, number, and sponsor.
 */

const mongoose = require('mongoose');

/* ------------------------------------------------------------------ */
/* Sub-schemas                                                          */
/* ------------------------------------------------------------------ */

/**
 * Customization options available for a product.
 * Defines which fields the customer can personalise and any constraints.
 */
const customizationOptionsSchema = new mongoose.Schema(
  {
    /** Whether the customer can add a player name to the kit */
    allowName: {
      type: Boolean,
      default: true,
    },

    /** Whether the customer can add a jersey number */
    allowNumber: {
      type: Boolean,
      default: true,
    },

    /** Whether the customer can choose/change the sponsor logo */
    allowSponsor: {
      type: Boolean,
      default: false,
    },

    /** Maximum character length for the player name */
    maxNameLength: {
      type: Number,
      default: 20,
      min: [1, 'maxNameLength must be at least 1'],
      max: [30, 'maxNameLength cannot exceed 30'],
    },

    /** Minimum jersey number allowed */
    minNumber: {
      type: Number,
      default: 1,
      min: [1, 'minNumber must be at least 1'],
    },

    /** Maximum jersey number allowed */
    maxNumber: {
      type: Number,
      default: 99,
      max: [99, 'maxNumber cannot exceed 99'],
    },

    /** Available sponsor options (image URLs or identifiers) */
    sponsorOptions: {
      type: [String],
      default: [],
    },

    /** Additional customization cost (e.g. for name/number printing) */
    customizationPrice: {
      type: Number,
      default: 0,
      min: [0, 'customizationPrice cannot be negative'],
    },
  },
  { _id: false }
);

/* ------------------------------------------------------------------ */
/* Main schema                                                          */
/* ------------------------------------------------------------------ */

const productSchema = new mongoose.Schema(
  {
    /** Reference to the Team this kit belongs to */
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Product must belong to a team'],
      index: true,
    },

    /** Product display name (e.g. "Brazil Home Kit 2026") */
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },

    /** Detailed product description */
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: '',
    },

    /** Kit type */
    kitType: {
      type: String,
      enum: {
        values: ['home', 'away', 'third', 'goalkeeper', 'training'],
        message: 'kitType must be one of: home, away, third, goalkeeper, training',
      },
      required: [true, 'Kit type is required'],
      lowercase: true,
    },

    /** Base price in USD */
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },

    /** Discounted / sale price (optional) */
    salePrice: {
      type: Number,
      min: [0, 'Sale price cannot be negative'],
      default: null,
    },

    /** Available sizes and their stock quantities */
    sizes: {
      type: Map,
      of: {
        type: Number,
        min: [0, 'Stock quantity cannot be negative'],
      },
      default: () =>
        new Map([
          ['XS', 0],
          ['S', 0],
          ['M', 0],
          ['L', 0],
          ['XL', 0],
          ['XXL', 0],
        ]),
    },

    /** Array of image URLs / paths for the product */
    images: {
      type: [String],
      default: [],
    },

    /** Primary / thumbnail image */
    thumbnail: {
      type: String,
      trim: true,
      default: '',
    },

    /** Customization options for this product */
    customizationOptions: {
      type: customizationOptionsSchema,
      default: () => ({}),
    },

    /** Whether the product is published and visible to customers */
    isActive: {
      type: Boolean,
      default: true,
    },

    /** Whether the product is marked as a new arrival */
    isNew: {
      type: Boolean,
      default: false,
    },

    /** Whether the product is featured on the home page */
    isFeatured: {
      type: Boolean,
      default: false,
    },

    /** Season / year (e.g. "2026") */
    season: {
      type: String,
      trim: true,
      default: '2026',
    },

    /** Tags for search / filtering */
    tags: {
      type: [String],
      default: [],
    },

    /** Total number of times this product has been sold */
    soldCount: {
      type: Number,
      default: 0,
      min: [0, 'soldCount cannot be negative'],
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
 * Virtual: effectivePrice
 * Returns the sale price if set, otherwise the regular price.
 */
productSchema.virtual('effectivePrice').get(function () {
  return this.salePrice != null && this.salePrice < this.price
    ? this.salePrice
    : this.price;
});

/**
 * Virtual: isOnSale
 * True when a valid sale price is set.
 */
productSchema.virtual('isOnSale').get(function () {
  return this.salePrice != null && this.salePrice < this.price;
});

/**
 * Virtual: totalStock
 * Sum of all size quantities.
 */
productSchema.virtual('totalStock').get(function () {
  if (!this.sizes) return 0;
  let total = 0;
  for (const qty of this.sizes.values()) {
    total += qty;
  }
  return total;
});

/**
 * Virtual: inStock
 * True when at least one size has stock.
 */
productSchema.virtual('inStock').get(function () {
  return this.totalStock > 0;
});

/* ------------------------------------------------------------------ */
/* Indexes                                                              */
/* ------------------------------------------------------------------ */

productSchema.index({ team: 1, isActive: 1 });
productSchema.index({ kitType: 1 });
productSchema.index({ price: 1 });
productSchema.index({ isNew: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

module.exports = mongoose.model('Product', productSchema);
