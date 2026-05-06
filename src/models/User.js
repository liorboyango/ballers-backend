/**
 * User Model
 *
 * Represents a registered customer or admin user.
 * Passwords are hashed with bcrypt before persistence.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/* ------------------------------------------------------------------ */
/* Address sub-schema                                                   */
/* ------------------------------------------------------------------ */

const addressSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    addressLine1: { type: String, trim: true, default: '' },
    addressLine2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

/* ------------------------------------------------------------------ */
/* Main schema                                                          */
/* ------------------------------------------------------------------ */

const userSchema = new mongoose.Schema(
  {
    /** User's first name */
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },

    /** User's last name */
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },

    /** Unique email address used for login */
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },

    /** Hashed password — never stored in plain text */
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // excluded from query results by default
    },

    /** User role */
    role: {
      type: String,
      enum: {
        values: ['customer', 'admin'],
        message: 'Role must be either customer or admin',
      },
      default: 'customer',
    },

    /** Saved shipping addresses */
    addresses: {
      type: [addressSchema],
      default: [],
    },

    /** Whether the account is active (not banned / deleted) */
    isActive: {
      type: Boolean,
      default: true,
    },

    /** Timestamp of the last successful login */
    lastLoginAt: {
      type: Date,
      default: null,
    },

    /** Password reset token (hashed) */
    passwordResetToken: {
      type: String,
      select: false,
      default: null,
    },

    /** Expiry for the password reset token */
    passwordResetExpires: {
      type: Date,
      select: false,
      default: null,
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

/** Virtual: fullName */
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

/* ------------------------------------------------------------------ */
/* Pre-save hook — hash password                                        */
/* ------------------------------------------------------------------ */

userSchema.pre('save', async function (next) {
  // Only hash when the password field has been modified
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Instance methods                                                     */
/* ------------------------------------------------------------------ */

/**
 * Compare a plain-text password against the stored hash.
 * @param {string} candidatePassword - The plain-text password to verify.
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Return a safe user object (without sensitive fields).
 * @returns {object}
 */
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  return obj;
};

/* ------------------------------------------------------------------ */
/* Indexes                                                              */
/* ------------------------------------------------------------------ */

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

module.exports = mongoose.model('User', userSchema);
