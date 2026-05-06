/**
 * Async Error Handler Wrapper
 * Wraps async route handlers to automatically catch rejected promises
 * and forward them to Express error handling middleware.
 * Eliminates the need for try/catch blocks in every controller.
 *
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 *
 * @example
 * router.get('/route', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   res.json(data);
 * }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
