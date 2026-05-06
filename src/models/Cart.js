/**
 * Cart Model
 * Stores a user's shopping cart with product references and customization data.
 */

const mongoose = require('mongoose');
const { SIZES } = require('../utils/constants');

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      default: 1,
    },
    size: {
      type: String,
      enum: SIZES,
      required: [true, 'Size is required'],
    },
    customization: {
      number: { type: String, default: '' },
      name: { type: String, default: '' },
      sponsor: { type: String, default: '' },
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    items: [cartItemSchema],
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: total price
cartSchema.virtual('total').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

// Virtual: item count
cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

const Cart = mongoose.model('Cart', cartSchema);
module.exports = Cart;
