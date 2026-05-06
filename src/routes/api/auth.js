/**
 * Auth Routes
 * POST /api/auth/register  - Register new user
 * POST /api/auth/login     - Login and receive JWT
 * GET  /api/auth/me        - Get current user profile (protected)
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');

const { register, login, getMe } = require('../../controllers/authCtrl');
const { protect } = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');

// Validation schemas
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(128).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', protect, getMe);

module.exports = router;
