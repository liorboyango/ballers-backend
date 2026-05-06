/**
 * Logger Utility
 *
 * Winston-based logger configured for both development (colorized console)
 * and production (JSON file + console) environments.
 *
 * Log levels: error > warn > info > http > verbose > debug > silly
 */

'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/** Custom log format for development: colorized, human-readable */
const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

/** Custom log format for production: structured JSON */
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/** Determine active log level based on environment */
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

/** Winston transports array */
const transports = [
  // Always log to console
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
];

// In production, also write to log files
if (process.env.NODE_ENV === 'production') {
  transports.push(
    // Combined log (all levels)
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: prodFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    // Error-only log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: prodFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );
}

/** The configured Winston logger instance */
const logger = winston.createLogger({
  level: logLevel,
  transports,
  exitOnError: false,
});

module.exports = logger;
