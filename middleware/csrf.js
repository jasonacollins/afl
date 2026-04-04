const crypto = require('crypto');
const { createForbiddenError } = require('../utils/error-handler');

// CSRF Protection Middleware
// Uses double submit cookie pattern with session-based tokens

function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfProtection(req, res, next) {
  // Generate CSRF token for session if it doesn't exist
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCSRFToken();
  }

  // Make token available to templates
  res.locals.csrfToken = req.session.csrfToken;

  // For non-GET requests, validate CSRF token
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const submittedToken = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    
    if (!submittedToken || submittedToken !== req.session.csrfToken) {
      return next(createForbiddenError('CSRF token validation failed'));
    }
  }

  next();
}

module.exports = csrfProtection;
