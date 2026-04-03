const csrfProtection = require('../csrf');

describe('csrf middleware', () => {
  test('creates a csrf token for the session and exposes it to templates', () => {
    const req = {
      method: 'GET',
      session: {},
      body: {},
      headers: {}
    };
    const res = { locals: {} };
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(typeof req.session.csrfToken).toBe('string');
    expect(req.session.csrfToken).toHaveLength(64);
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
    expect(next).toHaveBeenCalledWith();
  });

  test('accepts matching csrf tokens on write requests', () => {
    const req = {
      method: 'POST',
      session: { csrfToken: 'token-123' },
      body: { _csrf: 'token-123' },
      headers: {}
    };
    const res = { locals: {} };
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('rejects mismatched csrf tokens on write requests', () => {
    const req = {
      method: 'DELETE',
      session: { csrfToken: 'token-123' },
      body: {},
      headers: { 'x-csrf-token': 'wrong-token' }
    };
    const res = { locals: {} };
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error.message).toBe('CSRF token validation failed');
    expect(error.statusCode).toBe(403);
  });
});
