describe('logger', () => {
  const ORIGINAL_ENV = process.env;

  function loadLoggerModule({ nodeEnv = 'development', logDirExists = true } = {}) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: nodeEnv };

    const info = jest.fn();
    const warn = jest.fn();
    const createLogger = jest.fn(() => ({ info, warn }));
    const existsSync = jest.fn(() => logDirExists);
    const mkdirSync = jest.fn();
    const Console = jest.fn(function Console(options) {
      this.options = options;
    });
    const DailyRotateFile = jest.fn(function DailyRotateFile(options) {
      this.options = options;
    });

    jest.doMock('fs', () => ({
      existsSync,
      mkdirSync
    }));

    jest.doMock('winston', () => ({
      createLogger,
      transports: {
        Console,
        DailyRotateFile
      },
      format: {
        combine: jest.fn((...items) => ({ type: 'combine', items })),
        colorize: jest.fn(() => ({ type: 'colorize' })),
        timestamp: jest.fn(() => ({ type: 'timestamp' })),
        printf: jest.fn((formatter) => ({ type: 'printf', formatter })),
        json: jest.fn(() => ({ type: 'json' }))
      }
    }));

    jest.doMock('winston-daily-rotate-file', () => ({}));

    const loggerModule = require('../logger');

    return {
      ...loggerModule,
      mocks: {
        createLogger,
        existsSync,
        mkdirSync,
        Console,
        DailyRotateFile,
        info,
        warn
      }
    };
  }

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = ORIGINAL_ENV;
  });

  test('creates the logs directory when it does not already exist', () => {
    const { mocks } = loadLoggerModule({ logDirExists: false });

    expect(mocks.existsSync).toHaveBeenCalledWith(expect.stringMatching(/\/logs$/));
    expect(mocks.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(/\/logs$/));
    expect(mocks.createLogger).toHaveBeenCalledWith(expect.objectContaining({
      level: 'debug',
      exitOnError: false
    }));
    expect(mocks.Console).toHaveBeenCalledTimes(1);
    expect(mocks.DailyRotateFile).toHaveBeenCalledTimes(2);
  });

  test('uses info level in production and skips directory creation when logs already exist', () => {
    const { mocks } = loadLoggerModule({ nodeEnv: 'production', logDirExists: true });

    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.createLogger).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info'
    }));
  });

  test('requestLogger records successful requests with info logs', () => {
    const { requestLogger, mocks } = loadLoggerModule();
    let finishHandler = null;
    const req = {
      method: 'GET',
      originalUrl: '/health',
      body: {},
      params: {},
      query: {},
      ip: '127.0.0.1',
      session: { user: { id: 42 } },
      headers: {}
    };
    const res = {
      statusCode: 200,
      on: jest.fn((event, handler) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
      })
    };
    const next = jest.fn();

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

    finishHandler();

    expect(mocks.info).toHaveBeenCalledWith(expect.stringMatching(/^GET \/health 200 \d+ms$/));
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  test('requestLogger records failing requests with warning metadata and anonymous user fallback', () => {
    const { requestLogger, mocks } = loadLoggerModule();
    let finishHandler = null;
    const req = {
      method: 'POST',
      originalUrl: '/admin/api-refresh',
      body: { year: 2026, password: 'secret', _csrf: 'csrf-token' },
      params: { runId: '9' },
      query: { force: '1', token: 'raw-token' },
      ip: '192.0.2.10',
      session: null,
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'connect.sid=abc',
        'x-csrf-token': 'csrf-header'
      }
    };
    const res = {
      statusCode: 500,
      on: jest.fn((event, handler) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
      })
    };

    requestLogger(req, res, jest.fn());
    finishHandler();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^POST \/admin\/api-refresh 500 \d+ms$/),
      {
        body: { year: 2026, password: '[REDACTED]', _csrf: '[REDACTED]' },
        params: { runId: '9' },
        query: { force: '1', token: '[REDACTED]' },
        headers: {
          authorization: '[REDACTED]',
          cookie: '[REDACTED]',
          'x-csrf-token': '[REDACTED]'
        },
        ip: '192.0.2.10',
        user: 'anonymous'
      }
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
