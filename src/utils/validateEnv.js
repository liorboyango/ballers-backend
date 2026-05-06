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
 * Validates all required environment variables are present.
 * Throws an error listing all missing variables if any are absent.
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

  // Warn about optional vars using defaults
  OPTIONAL_ENV_VARS.forEach(({ name, default: defaultVal }) => {
    if (!process.env[name]) {
      process.env[name] = defaultVal;
    }
  });
}

module.exports = { validateEnv, REQUIRED_ENV_VARS, OPTIONAL_ENV_VARS };
