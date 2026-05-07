/**
 * Environment Variable Validator
 *
 * Validates that all required environment variables are present
 * before the application starts. Fails fast with a clear error message.
 */

'use strict';

/**
 * Required environment variables for the application to function.
 * Each entry has a name and description for helpful error messages.
 */
const REQUIRED_ENV_VARS = [
  {
    name: 'FIREBASE_SERVICE_ACCOUNT',
    description: 'Firebase service-account JSON (raw or base64-encoded)',
  },
  {
    name: 'JWT_SECRET',
    description: 'Secret key for signing JWT tokens (min 32 characters recommended)',
  },
];

/**
 * Optional environment variables with their defaults.
 * These are logged as warnings if not set.
 */
const OPTIONAL_ENV_VARS = [
  { name: 'PORT', default: '5000', description: 'HTTP server port' },
  { name: 'NODE_ENV', default: 'development', description: 'Application environment' },
  { name: 'FRONTEND_URL', default: 'http://localhost:3000', description: 'Frontend application URL for CORS' },
  { name: 'LOG_LEVEL', default: 'info', description: 'Winston log level' },
];

/**
 * Stripe-related environment variables.
 * These are not strictly required at startup (the app can run without
 * payment features), but a warning is emitted so operators know they
 * need to configure them before enabling checkout.
 */
const STRIPE_ENV_VARS = [
  {
    name: 'STRIPE_SECRET_KEY',
    description:
      'Stripe secret API key (sk_test_... or sk_live_...). Required for payment processing.',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    description:
      'Stripe webhook signing secret (whsec_...). Required for verifying webhook events.',
  },
];

/**
 * Validates all required environment variables are present.
 * Throws an error listing all missing variables if any are absent.
 * Emits console warnings for missing Stripe variables.
 *
 * @throws {Error} If any required environment variables are missing
 */
function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter(({ name }) => !process.env[name]);

  if (missing.length > 0) {
    const details = missing
      .map(({ name, description }) => `  - ${name}: ${description}`)
      .join('\n');
    throw new Error(
      `Missing required environment variables:\n${details}\n\nPlease check your .env file or deployment configuration.`
    );
  }

  // Apply defaults for optional vars that are not set
  OPTIONAL_ENV_VARS.forEach(({ name, default: defaultVal }) => {
    if (!process.env[name]) {
      process.env[name] = defaultVal;
    }
  });

  // Warn about missing Stripe configuration (non-fatal at startup)
  const missingStripe = STRIPE_ENV_VARS.filter(({ name }) => !process.env[name]);
  if (missingStripe.length > 0) {
    const details = missingStripe
      .map(({ name, description }) => `  - ${name}: ${description}`)
      .join('\n');
    console.warn(
      `[WARNING] Missing Stripe environment variables (payment features will be unavailable):\n${details}\n` +
        `Please add them to your .env file. See .env.example for guidance.`
    );
  }
}

module.exports = { validateEnv, REQUIRED_ENV_VARS, OPTIONAL_ENV_VARS, STRIPE_ENV_VARS };
