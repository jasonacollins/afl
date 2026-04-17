/**
 * Centralized logging service
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { sanitizeRequestMetadata } = require('./request-log-sanitizer');

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log formats
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    return `${timestamp} ${level}: ${message} ${
      Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : ''
    }`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// Use winston-daily-rotate-file to handle log rotation
require('winston-daily-rotate-file');

// Create the logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat
    }),
    // Rotating error log file
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: fileFormat,
      maxSize: '20m',
      maxFiles: '7d',
      zippedArchive: true
    }),
    // Rotating combined log file
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: fileFormat,
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  ],
  exitOnError: false
});

// Add request logging middleware for Express
const requestLogger = (req, res, next) => {
  const startTime = new Date();
  
  res.on('finish', () => {
    const duration = new Date() - startTime;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
    
    if (res.statusCode >= 400) {
      logger.warn(message, sanitizeRequestMetadata(req));
    } else {
      logger.info(message);
    }
  });
  
  next();
};

module.exports = {
  logger,
  requestLogger
};
