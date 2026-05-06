/**
 * Winston Logger Configuration
 * Provides structured logging with different transports for development and production.
 * - Development: colorized console output
 * - Production: JSON format to stdout + error file
 */
const { createLogger, format, transports } = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors, json } = format;

// Custom log format for development (human-readable)
const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
});

// Create logger instance
const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  defaultMeta: { service: 'ballers-backend' },
  transports: [],
});

if (process.env.NODE_ENV === 'production') {
  // Production: JSON format for log aggregation services
  logger.add(
    new transports.Console({
      format: combine(timestamp(), errors({ stack: true }), json()),
    })
  );

  // Also write errors to a file in production
  logger.add(
    new transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      format: combine(timestamp(), errors({ stack: true }), json()),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    })
  );
} else {
  // Development: colorized, human-readable output
  logger.add(
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        errors({ stack: true }),
        devFormat
      ),
    })
  );
}

module.exports = logger;
