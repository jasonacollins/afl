const { AppError, errorMiddleware, catchAsync } = require('../error-handler');

// Helpers to build mock Express req/res/next
function buildReq(overrides = {}) {
  const req = {
    headers: { accept: '*/*' },
    is: jest.fn(() => false),
    accepts: jest.fn(() => 'html'),
    xhr: false,
    ...overrides
  };
  return req;
}

function buildRes() {
  const res = {
    statusCode: 200,
    _json: null,
    _rendered: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res._json = body; return res; },
    render(view, locals) { res._rendered = { view, locals }; return res; }
  };
  return res;
}

describe('errorMiddleware', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  describe('production mode — operational errors', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    test('returns JSON when request has Accept: application/json', () => {
      const err = new AppError('Something failed', 500, 'API_REFRESH_ERROR');
      const req = buildReq({
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        is: jest.fn(() => true)
      });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res._json).toEqual({
        status: 'error',
        errorCode: 'API_REFRESH_ERROR',
        message: 'Something failed'
      });
      expect(res._rendered).toBeNull();
    });

    test('returns JSON when request Content-Type is application/json', () => {
      const err = new AppError('Bad request', 400, 'VALIDATION_ERROR');
      const req = buildReq({
        headers: { accept: '*/*', 'content-type': 'application/json' },
        is: jest.fn((type) => type === 'json')
      });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res._json).toBeTruthy();
      expect(res._json.message).toBe('Bad request');
      expect(res._rendered).toBeNull();
    });

    test('returns JSON for XHR requests', () => {
      const err = new AppError('Not found', 404, 'NOT_FOUND');
      const req = buildReq({ xhr: true });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(404);
      expect(res._json).toBeTruthy();
      expect(res._rendered).toBeNull();
    });

    test('renders HTML error page for browser navigation requests', () => {
      const err = new AppError('Page missing', 404, 'NOT_FOUND');
      const req = buildReq({
        headers: { accept: 'text/html,application/xhtml+xml' }
      });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(404);
      expect(res._rendered).toBeTruthy();
      expect(res._rendered.view).toBe('error');
      expect(res._json).toBeNull();
    });

    test('returns generic message in HTML for production errors', () => {
      const err = new AppError('secret internal detail', 500, 'INTERNAL_ERROR');
      const req = buildReq({
        headers: { accept: 'text/html' }
      });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res._rendered.locals.error).toBe('An unexpected error occurred');
    });
  });

  describe('production mode — unexpected (non-operational) errors', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    test('returns generic JSON for unexpected errors', () => {
      const err = new Error('kaboom');
      const req = buildReq({
        headers: { accept: 'application/json' }
      });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res._json.message).toBe('Something went wrong');
    });
  });

  describe('development mode', () => {
    beforeEach(() => { process.env.NODE_ENV = 'development'; });

    test('always returns JSON with stack trace', () => {
      const err = new AppError('dev error', 422, 'VALIDATION_ERROR');
      const req = buildReq();
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(422);
      expect(res._json.stack).toBeDefined();
      expect(res._json.message).toBe('dev error');
    });
  });

  describe('status code normalisation', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    test('treats plain 4xx errors as operational', () => {
      const err = new Error('bad input');
      err.status = 400; // Express-style status
      const req = buildReq({ headers: { accept: 'application/json' } });
      const res = buildRes();

      errorMiddleware(err, req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res._json.errorCode).toBe('VALIDATION_ERROR');
      expect(res._json.message).toBe('bad input');
    });
  });
});

describe('catchAsync', () => {
  test('passes rejected promise to next()', async () => {
    const error = new Error('async fail');
    const handler = catchAsync(async () => { throw error; });
    const next = jest.fn();

    await handler({}, {}, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
