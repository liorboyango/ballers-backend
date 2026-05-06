/**
 * Cart Controller
 * Manages shopping cart operations for authenticated users.
 * The cart is stored as a single Firestore document keyed by user id.
 *
 * Each item carries a uuid `id` so that update/remove flows can target it
 * (Firestore arrays don't get per-element ids automatically).
 */
const crypto = require('crypto');
const { admin } = require('../services/db');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const PRODUCT_FIELDS_FULL = ['name', 'price', 'imageUrl', 'team', 'kitType', 'sizes', 'stock'];
const PRODUCT_FIELDS_SHORT = ['name', 'price', 'imageUrl', 'team', 'kitType'];
const TEAM_FIELDS_FULL = ['name', 'country', 'flagUrl'];
const TEAM_FIELDS_SHORT = ['name', 'country'];

const pick = (obj, fields) => {
  const out = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f];
  return out;
};

const populateItems = async (items, productFields, teamFields) => {
  if (!items || items.length === 0) return [];

  const productIds = [...new Set(items.map((i) => i.product).filter(Boolean))];
  if (productIds.length === 0) return items.map((i) => ({ ...i, product: null }));

  const productSnaps = await admin
    .firestore()
    .getAll(...productIds.map((id) => Product.collection().doc(id)));
  const productById = new Map();
  for (const s of productSnaps) {
    if (s.exists) productById.set(s.id, { id: s.id, ...s.data() });
  }

  const teamIds = [...new Set([...productById.values()].map((p) => p.team).filter(Boolean))];
  const teamById = new Map();
  if (teamIds.length > 0) {
    const teamSnaps = await admin
      .firestore()
      .getAll(...teamIds.map((id) => Team.collection().doc(id)));
    for (const s of teamSnaps) {
      if (s.exists) teamById.set(s.id, { id: s.id, ...s.data() });
    }
  }

  return items.map((item) => {
    const p = productById.get(item.product);
    if (!p) return { ...item, product: null };
    const productView = { id: p.id, ...pick(p, productFields) };
    if (productView.team) {
      const team = teamById.get(productView.team);
      productView.team = team ? { id: team.id, ...pick(team, teamFields) } : null;
    }
    return { ...item, product: productView };
  });
};

const buildEmptyCart = () => ({ items: [], subtotal: 0, itemCount: 0 });

exports.getCart = asyncHandler(async (req, res, next) => {
  const snap = await Cart.docForUser(req.user.id).get();
  if (!snap.exists) {
    return res.status(200).json({ status: 'success', data: buildEmptyCart() });
  }

  const cart = Cart.serialize(snap);
  const items = await populateItems(cart.items || [], PRODUCT_FIELDS_FULL, TEAM_FIELDS_FULL);
  const subtotal = items.reduce(
    (sum, it) => sum + (it.product ? it.product.price : 0) * it.quantity,
    0
  );
  const itemCount = items.reduce((sum, it) => sum + it.quantity, 0);

  res.status(200).json({
    status: 'success',
    data: {
      ...cart,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      itemCount,
    },
  });
});

exports.addToCart = asyncHandler(async (req, res, next) => {
  const { productId, quantity = 1, customization } = req.body;

  const productSnap = await Product.collection().doc(productId).get();
  if (!productSnap.exists) {
    return next(new AppError('Product not found.', 404));
  }
  const product = Product.serialize(productSnap);

  if (product.stock !== undefined && product.stock < quantity) {
    return next(
      new AppError(
        `Insufficient stock. Only ${product.stock} item(s) available.`,
        400
      )
    );
  }

  if (!product.sizes.includes(customization.size)) {
    return next(
      new AppError(
        `Size ${customization.size} is not available for this product. Available sizes: ${product.sizes.join(', ')}.`,
        400
      )
    );
  }

  const ref = Cart.docForUser(req.user.id);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const cartSnap = await ref.get();
  const existingItems = cartSnap.exists ? cartSnap.data().items || [] : [];

  const matchIndex = existingItems.findIndex(
    (item) =>
      item.product === productId &&
      item.customization.size === customization.size &&
      item.customization.playerName === (customization.playerName || '') &&
      item.customization.playerNumber === (customization.playerNumber || null)
  );

  let items;
  if (matchIndex > -1) {
    const newQuantity = existingItems[matchIndex].quantity + quantity;
    if (newQuantity > 10) {
      return next(new AppError('Maximum quantity per item is 10.', 400));
    }
    items = existingItems.map((it, idx) =>
      idx === matchIndex ? { ...it, quantity: newQuantity } : it
    );
  } else {
    items = [
      ...existingItems,
      {
        id: crypto.randomUUID(),
        product: productId,
        quantity,
        customization: {
          size: customization.size,
          playerName: customization.playerName || '',
          playerNumber: customization.playerNumber || null,
        },
      },
    ];
  }

  if (cartSnap.exists) {
    await ref.update({ items, updatedAt: now });
  } else {
    await ref.set({ user: req.user.id, items, createdAt: now, updatedAt: now });
  }

  const populated = await populateItems(items, PRODUCT_FIELDS_SHORT, TEAM_FIELDS_SHORT);
  const itemCount = populated.reduce((sum, it) => sum + it.quantity, 0);

  logger.info(`Item added to cart for user ${req.user.id}: product ${productId}`);

  res.status(200).json({
    status: 'success',
    message: 'Item added to cart.',
    data: {
      id: req.user.id,
      user: req.user.id,
      items: populated,
      itemCount,
    },
  });
});

exports.updateCartItem = asyncHandler(async (req, res, next) => {
  const { itemId, quantity } = req.body;

  const ref = Cart.docForUser(req.user.id);
  const cartSnap = await ref.get();
  if (!cartSnap.exists) {
    return next(new AppError('Cart not found.', 404));
  }

  const existingItems = cartSnap.data().items || [];
  const idx = existingItems.findIndex((it) => it.id === itemId);
  if (idx === -1) {
    return next(new AppError('Cart item not found.', 404));
  }

  const items = existingItems.map((it, i) =>
    i === idx ? { ...it, quantity } : it
  );
  await ref.update({ items, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  const populated = await populateItems(items, PRODUCT_FIELDS_SHORT, TEAM_FIELDS_SHORT);
  const subtotal = populated.reduce(
    (sum, it) => sum + (it.product ? it.product.price : 0) * it.quantity,
    0
  );
  const itemCount = populated.reduce((sum, it) => sum + it.quantity, 0);

  res.status(200).json({
    status: 'success',
    message: 'Cart updated.',
    data: {
      id: req.user.id,
      user: req.user.id,
      items: populated,
      subtotal: Math.round(subtotal * 100) / 100,
      itemCount,
    },
  });
});

exports.removeCartItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.query;

  const ref = Cart.docForUser(req.user.id);
  const cartSnap = await ref.get();
  if (!cartSnap.exists) {
    return next(new AppError('Cart not found.', 404));
  }

  const existingItems = cartSnap.data().items || [];
  const items = existingItems.filter((it) => it.id !== itemId);
  if (items.length === existingItems.length) {
    return next(new AppError('Cart item not found.', 404));
  }

  await ref.update({ items, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  logger.info(`Item ${itemId} removed from cart for user ${req.user.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Item removed from cart.',
    data: {
      itemCount: items.reduce((sum, it) => sum + it.quantity, 0),
    },
  });
});

exports.clearCart = asyncHandler(async (req, res, next) => {
  const ref = Cart.docForUser(req.user.id);
  const cartSnap = await ref.get();
  if (!cartSnap.exists) {
    return res.status(200).json({
      status: 'success',
      message: 'Cart is already empty.',
    });
  }

  await ref.update({ items: [], updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  res.status(200).json({
    status: 'success',
    message: 'Cart cleared.',
    data: { items: [], subtotal: 0, itemCount: 0 },
  });
});
