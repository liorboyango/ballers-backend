/**
 * Product Controller
 * Handles CRUD operations for products (soccer kits).
 * Public endpoints: list, get by ID.
 * Protected endpoints: create, update, delete (admin only).
 *
 * Notes on Firestore translation:
 *  - `$or` and case-insensitive regex are not natively supported. The `search`
 *    parameter is applied in-memory after the query.
 *  - `populate('team', ...)` is replaced by an explicit follow-up read; for
 *    list responses we batch reads via getAll().
 *  - Product images are stored in Firebase Storage; `imageUrl` on the document
 *    is the public URL we wrote in the upload service.
 */
const { admin } = require('../services/db');
const {
  uploadProductImage,
  uploadProductImageBuffer,
  deleteProductImage,
} = require('../services/upload');
const { generateProductImage } = require('../services/imageGen');
const Product = require('../models/Product');
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');

const TEAM_LIST_FIELDS = ['name', 'country', 'flagUrl'];
const TEAM_DETAIL_FIELDS = ['name', 'country', 'flagUrl', 'group'];

const pickFields = (obj, fields) => {
  if (!obj) return null;
  const out = { id: obj.id };
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
};

const attachTeams = async (products, fields) => {
  const ids = [...new Set(products.map((p) => p.team).filter(Boolean))];
  if (ids.length === 0) return products;

  const refs = ids.map((id) => Team.collection().doc(id));
  const snaps = await admin.firestore().getAll(...refs);
  const byId = new Map();
  for (const s of snaps) {
    if (s.exists) byId.set(s.id, pickFields(Team.serialize(s), fields));
  }
  return products.map((p) => ({ ...p, team: byId.get(p.team) || null }));
};

exports.getProducts = asyncHandler(async (req, res, next) => {
  const {
    teamId,
    kitType,
    minPrice,
    maxPrice,
    size,
    search,
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    sort,
  } = req.query;

  let query = Product.collection();
  if (teamId) query = query.where('team', '==', teamId);
  if (kitType) query = query.where('kitType', '==', kitType);
  if (size) query = query.where('sizes', 'array-contains', size);
  if (minPrice !== undefined) query = query.where('price', '>=', Number(minPrice));
  if (maxPrice !== undefined) query = query.where('price', '<=', Number(maxPrice));

  let sortField = 'createdAt';
  let sortDir = 'desc';
  if (sort) {
    sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortDir = sort.startsWith('-') ? 'desc' : 'asc';
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    query = query.orderBy('price', sortDir);
    if (sortField !== 'price') query = query.orderBy(sortField, sortDir);
  } else {
    query = query.orderBy(sortField, sortDir);
  }

  let docs = (await query.get()).docs.map(Product.serialize);

  if (search) {
    const needle = search.toLowerCase();
    docs = docs.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(needle)) ||
        (p.description && p.description.toLowerCase().includes(needle))
    );
  }

  const total = docs.length;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;
  const pageDocs = docs.slice(skip, skip + limitNum);

  const products = await attachTeams(pageDocs, TEAM_LIST_FIELDS);

  res.status(200).json({
    status: 'success',
    results: products.length,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    },
    data: products,
  });
});

exports.getProductById = asyncHandler(async (req, res, next) => {
  const snap = await Product.collection().doc(req.params.id).get();
  if (!snap.exists) {
    return next(new AppError('Product not found.', 404));
  }

  const product = Product.serialize(snap);
  const [withTeam] = await attachTeams([product], TEAM_DETAIL_FIELDS);

  res.status(200).json({ status: 'success', data: withTeam });
});

exports.createProduct = asyncHandler(async (req, res, next) => {
  const teamSnap = await Team.collection().doc(req.body.teamId).get();
  if (!teamSnap.exists) {
    return next(new AppError('Team not found. Please provide a valid teamId.', 404));
  }

  const { teamId, ...rest } = req.body;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const productData = {
    ...rest,
    team: teamId,
    createdAt: now,
    updatedAt: now,
  };
  if (req.file) {
    productData.imageUrl = await uploadProductImage(req.file);
  } else {
    const team = Team.serialize(teamSnap);
    const t0 = Date.now();
    const generated = await generateProductImage({ product: productData, team });
    logger.info(`Image generated in ${Date.now() - t0}ms; uploading to storage`);
    const t1 = Date.now();
    productData.imageUrl = await uploadProductImageBuffer({
      buffer: generated.buffer,
      mimetype: generated.mimeType,
      ext: generated.ext,
    });
    logger.info(
      `AI-generated image attached for product "${productData.name}" (upload ${Date.now() - t1}ms, total ${Date.now() - t0}ms)`
    );
    if (req.aborted || res.writableEnded) {
      logger.warn(`Client disconnected before response for "${productData.name}"`);
    }
  }

  const ref = Product.collection().doc();
  await ref.set(productData);
  const snap = await ref.get();
  const product = Product.serialize(snap);
  const [withTeam] = await attachTeams([product], TEAM_LIST_FIELDS);

  logger.info(`Product created: ${product.name} (${product.id})`);

  res.status(201).json({
    status: 'success',
    message: 'Product created successfully.',
    data: withTeam,
  });
});

exports.updateProduct = asyncHandler(async (req, res, next) => {
  const ref = Product.collection().doc(req.params.id);
  const existing = await ref.get();
  if (!existing.exists) {
    return next(new AppError('Product not found.', 404));
  }

  const updateData = { ...req.body };
  if (updateData.teamId) {
    const teamSnap = await Team.collection().doc(updateData.teamId).get();
    if (!teamSnap.exists) {
      return next(new AppError('Team not found. Please provide a valid teamId.', 404));
    }
    updateData.team = updateData.teamId;
    delete updateData.teamId;
  }

  const previousImageUrl = existing.data().imageUrl;
  if (req.file) updateData.imageUrl = await uploadProductImage(req.file);
  updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await ref.update(updateData);

  if (req.file && previousImageUrl) {
    await deleteProductImage(previousImageUrl);
  }

  const snap = await ref.get();
  const product = Product.serialize(snap);
  const [withTeam] = await attachTeams([product], TEAM_LIST_FIELDS);

  logger.info(`Product updated: ${product.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Product updated successfully.',
    data: withTeam,
  });
});

exports.deleteProduct = asyncHandler(async (req, res, next) => {
  const ref = Product.collection().doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) {
    return next(new AppError('Product not found.', 404));
  }
  const imageUrl = snap.data().imageUrl;
  await ref.delete();
  if (imageUrl) await deleteProductImage(imageUrl);

  logger.info(`Product deleted: ${req.params.id}`);

  res.status(204).json({
    status: 'success',
    message: 'Product deleted successfully.',
    data: null,
  });
});
