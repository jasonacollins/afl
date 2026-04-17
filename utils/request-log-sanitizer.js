const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /^_csrf$/i,
  /csrf/i,
  /token/i,
  /^cookie$/i,
  /^authorization$/i,
  /^set-cookie$/i,
  /^x-csrf-token$/i
];

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce((sanitized, [key, entryValue]) => {
    sanitized[key] = isSensitiveKey(key) ? REDACTED_VALUE : sanitizeValue(entryValue);
    return sanitized;
  }, {});
}

function sanitizeRequestMetadata(req) {
  return {
    body: sanitizeValue(req.body || {}),
    params: sanitizeValue(req.params || {}),
    query: sanitizeValue(req.query || {}),
    headers: sanitizeValue({
      authorization: req.headers ? req.headers.authorization : undefined,
      cookie: req.headers ? req.headers.cookie : undefined,
      'x-csrf-token': req.headers ? req.headers['x-csrf-token'] : undefined
    }),
    ip: req.ip,
    user: req.session && req.session.user ? req.session.user.id : 'anonymous'
  };
}

module.exports = {
  REDACTED_VALUE,
  sanitizeRequestMetadata,
  sanitizeValue
};
