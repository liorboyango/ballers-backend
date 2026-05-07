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
 *
 * Image handling in createProduct:
 *  - Mode A (manual, existing): req.file → upload to storage → set imageUrl.
 *    If no file, Gemini auto-generates one (requires teamId).
 *  - Mode B (bulk import, new): req.body.images (array of URLs) → download
 *    each URL via downloadAndUploadImages → set images[] on document; teamId
 *    is optional; Gemini is bypassed entirely.
 */
const { admin } = require('../services/db');
const {
  uploadProductImage,
  uploadProductImageBuffer,
  deleteProductImage,
  deleteProductImages,
  downloadAndUploadImages,
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

/**
 * POST /api/products
 *
 * Creates a new product. Supports two image modes:
 *
 * **Mode A – manual (existing behaviour):**
 *   - `req.body.images` is absent/empty
 *   - If `req.file` is present: upload the file buffer to Storage → set `imageUrl`
 *   - If no file: generate image via Gemini (requires a valid `teamId`) → set `imageUrl`
 *
 * **Mode B – bulk import (new):**
 *   - `req.body.images` is a non-empty array of external image URLs
 *   - Each URL is downloaded, validated (MIME + size), and uploaded to Storage
 *   - The resulting Storage URLs are saved as `images[]` on the document
 *   - `teamId` is optional (null/omitted is fine)
 *   - Gemini image generation is completely bypassed
 *
 * Defaults applied when fields are omitted (useful for bulk import):
 *   - kitType: 'home'
 *   - sizes: ['S', 'M', 'L', 'XL', 'XXL']
 *   - price: 99.99
 *   - stock: 10
 *   - customizable: true
 */
exports.createProduct = asyncHandler(async (req, res, next) => {
  const { teamId, images: inputImages, ...rest } = req.body;

  const isBulkImport = Array.isArray(inputImages) && inputImages.length > 0;

  // ── Team validation ──────────────────────────────────────────────────────
  // In bulk-import mode teamId is optional; skip the lookup if not provided.
  let teamSnap = null;
  if (teamId) {
    teamSnap = await Team.collection().doc(teamId).get();
    if (!teamSnap.exists) {
      return next(new AppError('Team not found. Please provide a valid teamId.', 404));
    }
  } else if (!isBulkImport) {
    // Manual mode requires a teamId so Gemini can reference the team
    return next(
      new AppError(
        'teamId is required when not providing an images array.',
        400
      )
    );
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const productData = {
    ...rest,
    team: teamId || null,
    createdAt: now,
    updatedAt: now,
  };

  // ── Image handling ───────────────────────────────────────────────────────
  if (isBulkImport) {
    // ── Mode B: download external URLs and upload to Firebase Storage ──────
    logger.info(
      `Bulk import mode: downloading ${inputImages.length} external image(s) for "${productData.name}"`
    );
    const t0 = Date.now();

    const storageUrls = await downloadAndUploadImages(inputImages, { maxImages: 10 });

    logger.info(
      `Bulk import: uploaded ${storageUrls.length}/${inputImages.length} images ` +
      `for "${productData.name}" in ${Date.now() - t0}ms`
    );

    productData.images = storageUrls;
    // Also set imageUrl to the first image for backwards-compatibility with
    // consumers that only read the legacy imageUrl field.
    if (storageUrls.length > 0) {
      productData.imageUrl = storageUrls[0];
    }
  } else if (req.file) {
    // ── Mode A-i: uploaded file ─────────────────────────────────────────────
    productData.imageUrl = await uploadProductImage(req.file);
  } else {
    // ── Mode A-ii: Gemini auto-generation ──────────────────────────────────
    // teamSnap is guaranteed non-null here (teamId is required for this path)
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
      `AI-generated image attached for product "${productData.name}" ` +
      `(upload ${Date.now() - t1}ms, total ${Date.now() - t0}ms)`
    );
    if (req.aborted || res.writableEnded) {
      logger.warn(`Client disconnected before response for "${productData.name}"`);
    }
  }

  // ── Persist to Firestore ──────────────────────────────────────────────────
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
  const { imageUrl, images } = snap.data();
  await ref.delete();

  // Clean up all associated storage objects
  if (imageUrl) await deleteProductImage(imageUrl);
  if (Array.isArray(images) && images.length > 0) {
    // Filter out the primary imageUrl to avoid double-delete attempts
    const extraImages = images.filter((u) => u !== imageUrl);
    if (extraImages.length > 0) await deleteProductImages(extraImages);
  }

  logger.info(`Product deleted: ${req.params.id}`);

  res.status(204).json({
    status: 'success',
    message: 'Product deleted successfully.',
    data: null,
  });
});
