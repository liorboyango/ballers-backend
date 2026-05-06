/**
 * Authentication Controller
 * Handles user registration and login with JWT token generation.
 * Passwords are hashed with bcrypt before storage.
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { admin } = require('../services/db');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
};

exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await User.collection().where('email', '==', normalizedEmail).limit(1).get();
  if (!existing.empty) {
    return next(new AppError('An account with this email already exists.', 409));
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const docRef = User.collection().doc();
  await docRef.set({
    name: name.trim(),
    email: normalizedEmail,
    password: hashedPassword,
    role: 'user',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await docRef.get();
  const user = User.serialize(snap);

  const token = generateToken(user.id);
  logger.info(`New user registered: ${normalizedEmail}`);

  res.status(201).json({
    status: 'success',
    message: 'Account created successfully.',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  const result = await User.collection().where('email', '==', normalizedEmail).limit(1).get();
  if (result.empty) {
    return next(new AppError('Invalid email or password.', 401));
  }

  const user = User.serializeWithPassword(result.docs[0]);

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid email or password.', 401));
  }

  if (user.isActive === false) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 403));
  }

  const token = generateToken(user.id);
  logger.info(`User logged in: ${normalizedEmail}`);

  res.status(200).json({
    status: 'success',
    message: 'Logged in successfully.',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

exports.getMe = asyncHandler(async (req, res, next) => {
  const snap = await User.collection().doc(req.user.id).get();
  if (!snap.exists) {
    return next(new AppError('User not found.', 404));
  }

  const user = User.serialize(snap);
  res.status(200).json({
    status: 'success',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});
