describe('import-data automation', () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('initializes the database, syncs teams, and exits successfully', async () => {
    const initializeDatabase = jest.fn().mockResolvedValue();
    const syncTeams = jest.fn().mockResolvedValue();
    const logger = {
      info: jest.fn(),
      error: jest.fn()
    };
    process.exit = jest.fn();

    jest.doMock('../../../models/db', () => ({
      initializeDatabase
    }));
    jest.doMock('../sync-games', () => ({
      syncTeams
    }));
    jest.doMock('../../../utils/logger', () => ({
      logger
    }));

    let importData;
    jest.isolateModules(() => {
      ({ importData } = require('../import-data'));
    });

    await importData();

    expect(initializeDatabase).toHaveBeenCalledTimes(1);
    expect(syncTeams).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('logs failures and exits with status 1', async () => {
    const failure = new Error('db unavailable');
    const initializeDatabase = jest.fn().mockRejectedValue(failure);
    const syncTeams = jest.fn();
    const logger = {
      info: jest.fn(),
      error: jest.fn()
    };
    process.exit = jest.fn();

    jest.doMock('../../../models/db', () => ({
      initializeDatabase
    }));
    jest.doMock('../sync-games', () => ({
      syncTeams
    }));
    jest.doMock('../../../utils/logger', () => ({
      logger
    }));

    let importData;
    jest.isolateModules(() => {
      ({ importData } = require('../import-data'));
    });

    await importData();

    expect(syncTeams).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Error importing data',
      expect.objectContaining({
        error: 'db unavailable'
      })
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('logs sync team failures after initialization and exits with status 1', async () => {
    const failure = new Error('team import failed');
    const initializeDatabase = jest.fn().mockResolvedValue();
    const syncTeams = jest.fn().mockRejectedValue(failure);
    const logger = {
      info: jest.fn(),
      error: jest.fn()
    };
    process.exit = jest.fn();

    jest.doMock('../../../models/db', () => ({
      initializeDatabase
    }));
    jest.doMock('../sync-games', () => ({
      syncTeams
    }));
    jest.doMock('../../../utils/logger', () => ({
      logger
    }));

    let importData;
    jest.isolateModules(() => {
      ({ importData } = require('../import-data'));
    });

    await importData();

    expect(initializeDatabase).toHaveBeenCalledTimes(1);
    expect(syncTeams).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Error importing data',
      expect.objectContaining({
        error: 'team import failed'
      })
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
