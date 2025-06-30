// services/password-service.js
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

class PasswordService {
  constructor(commonPasswords = new Set()) {
    this.commonPasswords = commonPasswords;
  }

  isCommonPassword(password) {
    return this.commonPasswords.has(password.toLowerCase());
  }

  validatePassword(password) {
    const errors = [];

    // Check minimum length
    if (password.length < 12) {
      errors.push('Password must be at least 12 characters long');
    }

    // Check if it's a common password
    if (this.isCommonPassword(password)) {
      errors.push('This password is too common. Please choose a more unique password');
    }

    // Check for obvious patterns
    if (this.hasObviousPattern(password)) {
      errors.push('Password contains obvious patterns. Please choose a stronger password');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  hasObviousPattern(password) {
    const patterns = [
      /^(.)\1+$/,  // All same character (aaaaaaaa)
      /^(12345|123456|1234567|12345678|123456789|1234567890)/,  // Sequential numbers
      /^(abcdef|abcdefg|abcdefgh|abcdefghi)/i,  // Sequential letters
      /^password/i,  // Starts with "password"
      /^qwerty/i,  // Keyboard patterns
    ];

    return patterns.some(pattern => pattern.test(password));
  }
}

const loadCommonPasswordsFromFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const passwords = fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .map(p => p.trim().toLowerCase())
        .filter(p => p.length > 0);
      
      const commonPasswords = new Set(passwords);
      logger.info(`Loaded ${commonPasswords.size} common passwords`);
      return commonPasswords;
    } else {
      logger.warn('Common passwords file not found');
      return new Set();
    }
  } catch (error) {
    logger.error('Error loading common passwords', { error: error.message });
    return new Set();
  }
};

const commonPasswordsFilePath = path.join(__dirname, '../data/common-passwords.txt');
const commonPasswords = loadCommonPasswordsFromFile(commonPasswordsFilePath);

// Export a singleton instance for the app to use
module.exports = new PasswordService(commonPasswords);
// Also export the class and loader function for testing purposes
module.exports.PasswordService = PasswordService;
module.exports.loadCommonPasswordsFromFile = loadCommonPasswordsFromFile;
