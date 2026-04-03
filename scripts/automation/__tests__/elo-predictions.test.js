jest.mock('../../../models/db', () => ({
  runQuery: jest.fn(),
  getQuery: jest.fn(),
  getOne: jest.fn()
}));

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const { EventEmitter } = require('events');
const { getOne } = require('../../../models/db');
const { spawn } = require('child_process');
const fs = require('fs');
const { runEloPredictions } = require('../elo-predictions');

function createMockChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function queueChildResult({ code = 0, stdout = [], stderr = [] } = {}) {
  const child = createMockChildProcess();
  process.nextTick(() => {
    stdout.forEach((chunk) => child.stdout.emit('data', Buffer.from(chunk)));
    stderr.forEach((chunk) => child.stderr.emit('data', Buffer.from(chunk)));
    child.emit('close', code);
  });
  return child;
}

describe('elo-predictions automation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runs the margin-only prediction script and reports saved prediction counts', async () => {
    const currentYear = new Date().getFullYear();

    fs.existsSync.mockReturnValue(false);
    getOne.mockResolvedValue({ count: 7 });
    spawn.mockReturnValue(queueChildResult({ stdout: ['ok\n'] }));

    const result = await runEloPredictions();

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('/data/temp'),
      { recursive: true }
    );
    expect(spawn).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        'scripts/elo_margin_predict.py',
        '--start-year',
        String(currentYear),
        '--predictor-id',
        '6'
      ]),
      expect.objectContaining({
        cwd: expect.stringContaining('/afl')
      })
    );
    expect(result).toEqual({
      success: true,
      message: 'ELO predictions updated: 7 predictions saved to database',
      predictionsCount: 7
    });
  });

  test('throws when the python prediction script exits non-zero', async () => {
    fs.existsSync.mockReturnValue(true);
    spawn.mockReturnValue(queueChildResult({ code: 1, stderr: ['bad model'] }));

    await expect(runEloPredictions()).rejects.toThrow('Python script failed: bad model');
    expect(getOne).not.toHaveBeenCalled();
  });
});
