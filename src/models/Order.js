/**
 * Order Model
 * Stores completed orders with items snapshot, billing info, and status tracking.
 */

const mongoose = require('mongoose');
const { ORDER_STATUS, SIZES } = require('../utils/constants');

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    productName: { type: String, required: true },
    teamName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    size: { type: String, enum: SIZES, required: true },
    price: { type: Number, required: true, min: 0 },
    customization: {
      number: { type: String, default: '' },
      name: { type: String, default: '' },
      sponsor: { type: String, default: '' },
    },
  },
  { _id: true }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    zip: { type: String, required: true },
    country: { type: String, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      unique: true,
    },
    items: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
    subtotal: { type: Number, required: true, min: 0 },
    shippingCost: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    notes: { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
  }
);

// Auto-generate order number before saving
orderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.orderNumber = `BLR-${timestamp}-${random}`;
  }
  next();
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
