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
 * Rapyd-related environment variables.
 *
 * These are not strictly required at startup (the app can boot without
 * payment features), but a warning is emitted so operators know they need
 * to configure them before enabling checkout. RAPYD_WEBHOOK_URL is also
 * surfaced because Rapyd's HMAC signature includes the webhook URL — a
 * missing/incorrect value will silently break webhook delivery.
 *
 * Note: the legacy STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET variables
 * have been removed in the Rapyd cutover.
 */
const RAPYD_ENV_VARS = [
  {
    name: 'RAPYD_ACCESS_KEY',
    description:
      'Rapyd access key from the Client Portal (Developers → Credential Details). Required for payment processing.',
  },
  {
    name: 'RAPYD_SECRET_KEY',
    description:
      'Rapyd secret key used for HMAC request signing. Required for payment processing.',
  },
  {
    name: 'RAPYD_WEBHOOK_SECRET',
    description:
      'Rapyd webhook signing secret. Required for verifying inbound webhook events at /api/rapyd/webhook.',
  },
  {
    name: 'RAPYD_WEBHOOK_URL',
    description:
      'Public URL of the webhook endpoint as configured in the Rapyd dashboard. Required for HMAC signature verification.',
  },
];

/**
 * Validates all required environment variables are present.
 * Throws an error listing all missing variables if any are absent.
 * Emits console warnings for missing Rapyd variables.
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

  // Warn about missing Rapyd configuration (non-fatal at startup)
  const missingRapyd = RAPYD_ENV_VARS.filter(({ name }) => !process.env[name]);
  if (missingRapyd.length > 0) {
    const details = missingRapyd
      .map(({ name, description }) => `  - ${name}: ${description}`)
      .join('\n');
    console.warn(
      `[WARNING] Missing Rapyd environment variables (payment features will be unavailable):\n${details}\n` +
        `Please add them to your .env file. See .env.example for guidance.`
    );
  }
}

module.exports = { validateEnv, REQUIRED_ENV_VARS, OPTIONAL_ENV_VARS, RAPYD_ENV_VARS };
