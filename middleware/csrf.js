const crypto = require('crypto');

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
    const submittedToken = req.body._csrf || req.headers['x-csrf-token'];
    
    if (!submittedToken || submittedToken !== req.session.csrfToken) {
      const error = new Error('CSRF token validation failed');
      error.status = 403;
      return next(error);
    }
  }

  next();
}

module.exports = csrfProtection;