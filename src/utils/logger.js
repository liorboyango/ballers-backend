/**
 * Simple logger utility.
 * Uses console with timestamps. Can be swapped for Winston in production.
 */

const formatMessage = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const extra = args.length ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ') : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}`;
};

const logger = {
  info: (message, ...args) => console.log(formatMessage('info', message, ...args)),
  warn: (message, ...args) => console.warn(formatMessage('warn', message, ...args)),
  error: (message, ...args) => console.error(formatMessage('error', message, ...args)),
  debug: (message, ...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatMessage('debug', message, ...args));
    }
  },
};

module.exports = logger;
