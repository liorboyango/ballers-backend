/**
 * Product Model
 * Mongoose schema for soccer team T-shirts with customization options.
 * Supports image storage (URL references to uploaded files).
 */

const mongoose = require('mongoose');

/**
 * Customization options schema
 * Defines what can be personalized on a jersey
 */
const customizationSchema = new mongoose.Schema(
  {
    allowNumber: {
      type: Boolean,
      default: true,
    },
    allowName: {
      type: Boolean,
      default: true,
    },
    allowSponsor: {
      type: Boolean,
      default: false,
    },
    defaultNumber: {
      type: String,
      default: '',
    },
    defaultName: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

/**
 * Product schema
 */
const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Team ID is required'],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: {
        values: ['home', 'away', 'third', 'goalkeeper', 'training'],
        message: 'Category must be one of: home, away, third, goalkeeper, training',
      },
      index: true,
    },
    sizes: {
      type: [String],
      enum: {
        values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
        message: 'Invalid size value',
      },
      default: ['S', 'M', 'L', 'XL'],
    },
    /**
     * Primary image URL - points to /uploads/<filename> for local uploads
     * or an external URL for seeded/external images
     */
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Additional product images array
     * Each entry is a URL path to an uploaded image
     */
    images: {
      type: [String],
      default: [],
    },
    sponsor: {
      type: String,
      trim: true,
      default: '',
    },
    customization: {
      type: customizationSchema,
      default: () => ({}),
    },
    inStock: {
      type: Boolean,
      default: true,
      index: true,
    },
    featured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ───────────────────────────────────────────────────────────────────

// Compound index for common query patterns
productSchema.index({ teamId: 1, category: 1 });
productSchema.index({ price: 1 });
productSchema.index({ featured: 1, createdAt: -1 });

// Text search index
productSchema.index({ name: 'text', description: 'text' });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

/**
 * Virtual: primaryImage
 * Returns the primary image URL or the first image in the array
 */
productSchema.virtual('primaryImage').get(function () {
  return this.imageUrl || (this.images && this.images[0]) || null;
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
