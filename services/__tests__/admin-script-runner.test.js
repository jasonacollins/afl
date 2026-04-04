jest.mock('../../models/db', () => ({
  runQuery: jest.fn(),
  getQuery: jest.fn(),
  getOne: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const { getOne } = require('../../models/db');
const { spawn } = require('child_process');
const adminScriptRunner = require('../admin-script-runner');

const {
  assertActivePredictor,
  buildScriptCommand,
  chooseDefaultPredictorId,
  normalizeBoolean,
  normalizeRepoPath,
  toInteger
} = adminScriptRunner.__testables;

function createMockChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = jest.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

async function waitFor(assertion, timeoutMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for async condition');
}

describe('Admin Script Runner - win margin methods command builder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOne.mockResolvedValue({ predictor_id: 8, display_name: 'Testing Predictor' });
  });

  test('builds win-margin-methods-predictions command with optional flags', async () => {
    const commandSpec = await buildScriptCommand('win-margin-methods-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginMethodsPath: 'data/models/win/optimal_margin_methods_trained_to_2025.json',
      predictorId: 8,
      dbPath: 'data/database/afl_predictions.db',
      outputDir: 'data/predictions/win',
      saveToDb: true,
      futureOnly: true,
      overrideCompleted: true,
      methodOverride: 'Linear',
      allowModelMismatch: true
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_margin_methods_predict.py',
      '--start-year', '2026',
      '--elo-model', 'data/models/win/afl_elo_win_trained_to_2025.json',
      '--margin-methods', 'data/models/win/optimal_margin_methods_trained_to_2025.json',
      '--predictor-id', '8',
      '--future-only',
      '--override-completed',
      '--method-override', 'linear',
      '--allow-model-mismatch'
    ]));
  });

  test('rejects invalid method override value', async () => {
    await expect(buildScriptCommand('win-margin-methods-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginMethodsPath: 'data/models/win/optimal_margin_methods_trained_to_2025.json',
      predictorId: 8,
      methodOverride: 'foo'
    })).rejects.toThrow('methodOverride must be one of: simple, linear, diminishing_returns');
  });

  test('rejects non-margin-methods artifact for marginMethodsPath', async () => {
    await expect(buildScriptCommand('win-margin-methods-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginMethodsPath: 'data/models/win/optimal_elo_params_win_trained_to_2025.json',
      predictorId: 8
    })).rejects.toThrow('marginMethodsPath must reference an optimal_margin_methods artifact');
  });
});

describe('Admin Script Runner - win margin methods optimize command builder', () => {
  test('builds win-margin-methods-optimize command with defaults', async () => {
    const commandSpec = await buildScriptCommand('win-margin-methods-optimize', {
      eloParamsPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      startYear: 1990,
      endYear: 2025
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_margin_methods_optimize.py',
      '--elo-params', 'data/models/win/afl_elo_win_trained_to_2025.json',
      '--start-year', '1990',
      '--end-year', '2025',
      '--n-calls', '100',
      '--random-seed', '42',
      '--db-path', 'data/database/afl_predictions.db',
      '--output-path', 'data/models/win/optimal_margin_methods_trained_to_2025.json'
    ]));
  });

  test('rejects invalid optimize year window', async () => {
    await expect(buildScriptCommand('win-margin-methods-optimize', {
      eloParamsPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      startYear: 2025,
      endYear: 2024
    })).rejects.toThrow('startYear cannot be greater than endYear');
  });

  test('rejects margin-methods artifact as optimize input model', async () => {
    await expect(buildScriptCommand('win-margin-methods-optimize', {
      eloParamsPath: 'data/models/win/optimal_margin_methods_trained_to_2025.json',
      startYear: 1990,
      endYear: 2025
    })).rejects.toThrow('eloParamsPath must reference a win model/params artifact');
  });
});

describe('Admin Script Runner - win model file-type validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOne.mockResolvedValue({ predictor_id: 8, display_name: 'Testing Predictor' });
  });

  test('rejects win params file as combined prediction win model', async () => {
    await expect(buildScriptCommand('combined-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/optimal_elo_params_win_trained_to_2025.json',
      marginModelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      predictorId: 8
    })).rejects.toThrow('winModelPath must reference a trained win model artifact');
  });

  test('rejects trained win model as win training params file', async () => {
    await expect(buildScriptCommand('win-train', {
      paramsFile: 'data/models/win/afl_elo_win_trained_to_2025.json'
    })).rejects.toThrow('paramsFile must reference an optimal_elo_params_win artifact');
  });
});

describe('Admin Script Runner - additional command builder coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOne.mockResolvedValue({ predictor_id: 8, display_name: 'Testing Predictor' });
  });

  test('builds combined-predictions command with optional flags', async () => {
    const commandSpec = await buildScriptCommand('combined-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginModelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      predictorId: 8,
      futureOnly: true,
      saveToDb: false
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_predict_combined.py',
      '--start-year', '2026',
      '--win-model', 'data/models/win/afl_elo_win_trained_to_2025.json',
      '--margin-model', 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      '--predictor-id', '8',
      '--no-save-to-db',
      '--future-only'
    ]));
    expect(commandSpec.normalizedParams).toEqual(expect.objectContaining({
      futureOnly: true,
      saveToDb: false
    }));
  });

  test('builds margin-predictions command with override-completed and no-save flags', async () => {
    const commandSpec = await buildScriptCommand('margin-predictions', {
      startYear: 2026,
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      predictorId: 8,
      overrideCompleted: true,
      saveToDb: false
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_margin_predict.py',
      '--start-year', '2026',
      '--model-path', 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      '--predictor-id', '8',
      '--no-save-to-db',
      '--override-completed'
    ]));
  });

  test('builds season-simulation command with win model and backfill flag', async () => {
    const commandSpec = await buildScriptCommand('season-simulation', {
      year: 2026,
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      numSimulations: 75000,
      backfillRoundSnapshots: true
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/season_simulator.py',
      '--year', '2026',
      '--model-path', 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      '--win-model', 'data/models/win/afl_elo_win_trained_to_2025.json',
      '--num-simulations', '75000',
      '--backfill-round-snapshots'
    ]));
    expect(commandSpec.normalizedParams.output).toBe('data/simulations/season_simulation_2026.json');
  });

  test('builds season-simulation from-scratch output path suffix', async () => {
    const commandSpec = await buildScriptCommand('season-simulation', {
      year: 2026,
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      fromScratch: true
    });

    expect(commandSpec.args).toEqual(expect.arrayContaining([
      '--from-scratch',
      '--output', 'data/simulations/season_simulation_2026_from_scratch.json'
    ]));
  });

  test('rejects incompatible season-simulation flags', async () => {
    await expect(buildScriptCommand('season-simulation', {
      year: 2026,
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      fromScratch: true,
      backfillRoundSnapshots: true
    })).rejects.toThrow('fromScratch cannot be combined with backfillRoundSnapshots');
  });

  test('rejects win params artifacts as season-simulation win models', async () => {
    await expect(buildScriptCommand('season-simulation', {
      year: 2026,
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      winModelPath: 'data/models/win/optimal_elo_params_win_trained_to_2025.json'
    })).rejects.toThrow('winModelPath must reference a trained win model artifact');
  });

  test('builds elo-history command with explicit seed and output year windows', async () => {
    const commandSpec = await buildScriptCommand('elo-history', {
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      mode: 'full',
      seedStartYear: 1995,
      seedEndYear: 2005,
      outputStartYear: 2000,
      outputEndYear: 2006,
      outputPrefix: 'custom_history'
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_history_generator.py',
      '--model-path', 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      '--mode', 'full',
      '--seed-start-year', '1995',
      '--seed-end-year', '2005',
      '--output-start-year', '2000',
      '--output-end-year', '2006',
      '--output-prefix', 'custom_history'
    ]));
  });

  test('rejects invalid elo-history mode', async () => {
    await expect(buildScriptCommand('elo-history', {
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      mode: 'delta'
    })).rejects.toThrow('mode must be one of: full, incremental');
  });

  test('rejects inverted elo-history output year ranges', async () => {
    await expect(buildScriptCommand('elo-history', {
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      outputStartYear: 2020,
      outputEndYear: 2019
    })).rejects.toThrow('outputStartYear cannot be greater than outputEndYear');
  });

  test('builds margin-optimize command using the trained-to-year output path', async () => {
    const commandSpec = await buildScriptCommand('margin-optimize', {
      startYear: 1990,
      endYear: 2025,
      maxCombinations: 250
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_margin_optimize.py',
      '--start-year', '1990',
      '--end-year', '2025',
      '--max-combinations', '250',
      '--output-path', 'data/models/margin/optimal_margin_only_elo_params_trained_to_2025.json'
    ]));
  });

  test('builds win-train command with optional params and margin methods artifacts', async () => {
    const commandSpec = await buildScriptCommand('win-train', {
      startYear: 1990,
      endYear: 2025,
      noTuneParameters: true,
      cvFolds: 5,
      maxCombinations: 1200,
      paramsFile: 'data/models/win/optimal_elo_params_win_trained_to_2024.json',
      marginParams: 'data/models/win/optimal_margin_methods_trained_to_2025.json'
    });

    expect(commandSpec.command).toBe('python3');
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      'scripts/elo_win_train.py',
      '--start-year', '1990',
      '--end-year', '2025',
      '--cv-folds', '5',
      '--max-combinations', '1200',
      '--no-tune-parameters',
      '--params-file', 'data/models/win/optimal_elo_params_win_trained_to_2024.json',
      '--margin-params', 'data/models/win/optimal_margin_methods_trained_to_2025.json'
    ]));
  });

  test('rejects non-margin-methods artifacts for win-train marginParams', async () => {
    await expect(buildScriptCommand('win-train', {
      marginParams: 'data/models/win/optimal_elo_params_win_trained_to_2025.json'
    })).rejects.toThrow('marginParams must reference an optimal_margin_methods artifact');
  });

  test('accepts string boolean form inputs for margin predictions', async () => {
    const commandSpec = await buildScriptCommand('margin-predictions', {
      startYear: '2026',
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      predictorId: '8',
      saveToDb: '0',
      overrideCompleted: 'yes'
    });

    expect(commandSpec.normalizedParams).toEqual(expect.objectContaining({
      predictorId: 8,
      saveToDb: false,
      overrideCompleted: true
    }));
    expect(commandSpec.args).toEqual(expect.arrayContaining([
      '--predictor-id', '8',
      '--no-save-to-db',
      '--override-completed'
    ]));
  });

  test('rejects invalid boolean form inputs through command normalization', async () => {
    await expect(buildScriptCommand('combined-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginModelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      predictorId: 8,
      futureOnly: 'maybe'
    })).rejects.toThrow('Invalid boolean value');
  });
});

describe('Admin Script Runner - helper validation coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizeBoolean supports common form values and fallback defaults', () => {
    expect(normalizeBoolean(undefined, true)).toBe(true);
    expect(normalizeBoolean('YES')).toBe(true);
    expect(normalizeBoolean('off')).toBe(false);
    expect(() => normalizeBoolean('sometimes')).toThrow('Invalid boolean value');
  });

  test('toInteger enforces required, numeric, and range validation', () => {
    expect(toInteger('42', 'year', { required: true, min: 1, max: 100 })).toBe(42);
    expect(() => toInteger('', 'year', { required: true })).toThrow('year is required');
    expect(() => toInteger('abc', 'year')).toThrow('year must be an integer');
    expect(() => toInteger('0', 'year', { min: 1, max: 5 })).toThrow('year must be between 1 and 5');
  });

  test('normalizeRepoPath enforces approved data-directory bases', () => {
    expect(normalizeRepoPath('data/models/win/afl_elo_win_trained_to_2025.json', 'modelPath')).toBe(
      'data/models/win/afl_elo_win_trained_to_2025.json'
    );
    expect(() => normalizeRepoPath('package.json', 'modelPath')).toThrow(
      'modelPath must be under an approved data directory'
    );
  });

  test('chooseDefaultPredictorId prefers the configured predictor and falls back to the first active entry', () => {
    expect(chooseDefaultPredictorId([
      { predictor_id: 1 },
      { predictor_id: 6 },
      { predictor_id: 8 }
    ])).toBe(6);
    expect(chooseDefaultPredictorId([
      { predictor_id: 1 },
      { predictor_id: 8 }
    ])).toBe(1);
    expect(chooseDefaultPredictorId([])).toBeNull();
  });

  test('assertActivePredictor rejects inactive predictor ids', async () => {
    getOne.mockResolvedValue(null);

    await expect(assertActivePredictor(999)).rejects.toThrow(
      'predictorId must reference an active predictor'
    );
  });
});

describe('Admin Script Runner - persisted logs and recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('startScriptRun rejects when an active run already exists in the database', async () => {
    const { runQuery } = require('../../models/db');

    getOne.mockResolvedValue({
      run_id: 99,
      script_key: 'sync-games',
      status: 'running'
    });

    await expect(
      adminScriptRunner.startScriptRun('sync-games', { year: 2026 }, 9)
    ).rejects.toMatchObject({
      code: 'ACTIVE_RUN_EXISTS',
      message: 'An admin script is already running'
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  test('startScriptRun spawns the script, persists streamed logs, and marks the run succeeded', async () => {
    const { runQuery } = require('../../models/db');
    const child = createMockChildProcess();
    spawn.mockReturnValue(child);
    getOne.mockResolvedValueOnce(null);
    runQuery
      .mockResolvedValueOnce({ lastID: 41 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const run = await adminScriptRunner.startScriptRun('sync-games', { year: 2026 }, 9);
    const logPath = runQuery.mock.calls[1][1][2];
    const absoluteLogPath = path.join(__dirname, '..', '..', logPath);

    child.stdout.emit('data', Buffer.from('synced fixture\n'));
    child.stderr.emit('data', Buffer.from('warning line\n'));
    child.emit('close', 0);

    await waitFor(() => runQuery.mock.calls.length >= 3);

    const logLines = (await fs.readFile(absoluteLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).message);

    try {
      expect(run).toEqual({
        runId: 41,
        scriptKey: 'sync-games',
        status: 'running',
        startedAt: expect.any(String)
      });
      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['scripts/automation/sync-games.js', 'year', '2026'],
        expect.objectContaining({
          cwd: expect.stringContaining('/afl'),
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
      expect(runQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO admin_script_runs'),
        ['sync-games', 'queued', 9, expect.any(String)]
      );
      expect(runQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE admin_script_runs'),
        ['running', expect.any(String), logPath, 41]
      );
      expect(runQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE admin_script_runs'),
        ['succeeded', 0, null, expect.any(String), 41]
      );
      expect(logLines).toEqual(expect.arrayContaining([
        'Starting command: node scripts/automation/sync-games.js year 2026',
        'synced fixture',
        'warning line',
        'Run completed successfully (exit code 0)'
      ]));
    } finally {
      await fs.rm(absoluteLogPath, { force: true });
    }
  });

  test('startScriptRun records heartbeat progress snapshots for long-running python jobs', async () => {
    const { runQuery } = require('../../models/db');
    const child = createMockChildProcess();
    let heartbeatCallback = null;
    let nowMs = 0;
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation((callback) => {
      heartbeatCallback = callback;
      return 123;
    });
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);

    spawn.mockReturnValue(child);
    getOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ predictor_id: 8, display_name: 'Testing Predictor' });
    runQuery
      .mockResolvedValueOnce({ lastID: 42 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const run = await adminScriptRunner.startScriptRun('win-margin-methods-predictions', {
      startYear: 2026,
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginMethodsPath: 'data/models/win/optimal_margin_methods_trained_to_2025.json',
      predictorId: 8
    }, 9);
    const logPath = runQuery.mock.calls[1][1][2];
    const absoluteLogPath = path.join(__dirname, '..', '..', logPath);

    child.stdout.emit('data', Buffer.from('progress 3/10\n'));
    nowMs = 15000;
    heartbeatCallback();
    child.emit('close', 0);
    await waitFor(() => runQuery.mock.calls.length >= 3);

    const logLines = (await fs.readFile(absoluteLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).message);

    try {
      expect(run.runId).toBe(42);
      expect(spawn).toHaveBeenCalledWith(
        'python3',
        expect.arrayContaining([
          '-u',
          'scripts/elo_margin_methods_predict.py',
          '--start-year',
          '2026'
        ]),
        expect.any(Object)
      );
      expect(logLines).toEqual(expect.arrayContaining([
        'progress 3/10',
        expect.stringContaining('Progress snapshot: elapsed 15s'),
        expect.stringContaining('latest progress 3/10 (30%)')
      ]));
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      dateNowSpy.mockRestore();
      await fs.rm(absoluteLogPath, { force: true });
    }
  });

  test('startScriptRun marks the run failed when the child process emits a startup error', async () => {
    const { runQuery } = require('../../models/db');
    const child = createMockChildProcess();

    spawn.mockReturnValue(child);
    getOne.mockResolvedValueOnce(null);
    runQuery
      .mockResolvedValueOnce({ lastID: 43 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const run = await adminScriptRunner.startScriptRun('sync-games', { year: 2026 }, 9);
    const logPath = runQuery.mock.calls[1][1][2];
    const absoluteLogPath = path.join(__dirname, '..', '..', logPath);

    child.emit('error', new Error('spawn EACCES'));
    await waitFor(() => runQuery.mock.calls.length >= 3);

    const logLines = (await fs.readFile(absoluteLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).message);

    try {
      expect(run.runId).toBe(43);
      expect(runQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE admin_script_runs'),
        ['failed', null, 'Process failed to start: spawn EACCES', expect.any(String), 43]
      );
      expect(logLines).toEqual(expect.arrayContaining([
        'Starting command: node scripts/automation/sync-games.js year 2026',
        'Process failed to start: spawn EACCES'
      ]));
    } finally {
      await fs.rm(absoluteLogPath, { force: true });
    }
  });

  test('getRunLogs parses structured log lines and falls back to system messages for plain text', async () => {
    const runId = 401;
    const relativeLogPath = path.posix.join(
      'logs',
      'admin-scripts',
      '2099',
      '12',
      `run-${process.pid}-${Date.now()}.log`
    );
    const absoluteLogPath = path.join(__dirname, '..', '..', relativeLogPath);

    await fs.mkdir(path.dirname(absoluteLogPath), { recursive: true });
    await fs.writeFile(
      absoluteLogPath,
      `${JSON.stringify({
        created_at: '2026-04-03T00:00:00.000Z',
        stream: 'stdout',
        message: 'first line'
      })}\nplain text line\n`,
      'utf8'
    );

    getOne.mockResolvedValue({ run_id: runId, log_path: relativeLogPath });

    try {
      const logs = await adminScriptRunner.getRunLogs(runId);

      expect(logs).toEqual([
        {
          log_id: null,
          run_id: runId,
          seq: 1,
          stream: 'stdout',
          message: 'first line',
          created_at: '2026-04-03T00:00:00.000Z'
        },
        {
          log_id: null,
          run_id: runId,
          seq: 2,
          stream: 'system',
          message: 'plain text line',
          created_at: expect.any(String)
        }
      ]);
    } finally {
      await fs.rm(absoluteLogPath, { force: true });
    }
  });

  test('recoverInterruptedRuns marks queued and running rows as interrupted', async () => {
    const { runQuery } = require('../../models/db');
    runQuery.mockResolvedValue({ changes: 2 });

    const recoveredCount = await adminScriptRunner.recoverInterruptedRuns();

    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE admin_script_runs'),
      [
        'interrupted',
        expect.any(String),
        'queued',
        'running'
      ]
    );
    expect(recoveredCount).toBe(2);
  });
});

describe('Admin Script Runner - metadata and log edge cases', () => {
  let readdirSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    readdirSpy = jest.spyOn(fs, 'readdir');
  });

  afterEach(() => {
    readdirSpy.mockRestore();
  });

  test('getScriptMetadata groups model files and picks preferred default predictors', async () => {
    const { getQuery } = require('../../models/db');

    readdirSpy
      .mockResolvedValueOnce([
        { name: 'afl_elo_win_trained_to_2025.json', isFile: () => true },
        { name: 'optimal_elo_params_win_trained_to_2025.json', isFile: () => true },
        { name: 'optimal_margin_methods_trained_to_2025.json', isFile: () => true },
        { name: 'notes.txt', isFile: () => true }
      ])
      .mockResolvedValueOnce([
        { name: 'afl_elo_margin_only_trained_to_2025.json', isFile: () => true }
      ]);

    getQuery.mockResolvedValue([
      { predictor_id: 1, display_name: 'Alpha' },
      { predictor_id: 6, display_name: "Dad's AI" },
      { predictor_id: 8, display_name: 'Testing Predictor' }
    ]);

    const metadata = await adminScriptRunner.getScriptMetadata();

    expect(metadata.modelFiles).toEqual(expect.objectContaining({
      win: expect.arrayContaining([
        'data/models/win/afl_elo_win_trained_to_2025.json',
        'data/models/win/optimal_elo_params_win_trained_to_2025.json',
        'data/models/win/optimal_margin_methods_trained_to_2025.json'
      ]),
      margin: ['data/models/margin/afl_elo_margin_only_trained_to_2025.json'],
      winModels: ['data/models/win/afl_elo_win_trained_to_2025.json'],
      winParams: ['data/models/win/optimal_elo_params_win_trained_to_2025.json'],
      winMarginMethods: ['data/models/win/optimal_margin_methods_trained_to_2025.json']
    }));
    expect(metadata.defaults).toEqual(expect.objectContaining({
      predictorId: 6,
      marginPredictorId: 1,
      winMarginMethodsPredictorId: 8,
      dbPath: 'data/database/afl_predictions.db'
    }));
    expect(metadata.scripts).toEqual(expect.any(Array));
  });

  test('getScriptMetadata tolerates unreadable model directories', async () => {
    const { getQuery } = require('../../models/db');

    readdirSpy.mockRejectedValue(new Error('permission denied'));
    getQuery.mockResolvedValue([{ predictor_id: 6, display_name: "Dad's AI" }]);

    const metadata = await adminScriptRunner.getScriptMetadata();

    expect(metadata.modelFiles.win).toEqual([]);
    expect(metadata.modelFiles.margin).toEqual([]);
    expect(metadata.defaults.predictorId).toBe(6);
  });

  test('buildScriptCommand rejects paths outside the project root', async () => {
    await expect(adminScriptRunner.__testables.buildScriptCommand('season-simulation', {
      year: 2026,
      modelPath: '../../outside.json'
    })).rejects.toThrow('modelPath must resolve inside the project root');
  });

  test('getRunLogs returns a placeholder when the run has no log path', async () => {
    getOne.mockResolvedValue({ run_id: 55, log_path: null });

    await expect(adminScriptRunner.getRunLogs(55)).resolves.toEqual([
      {
        log_id: null,
        run_id: 55,
        seq: 1,
        stream: 'system',
        message: 'No log file is available for this run.',
        created_at: expect.any(String)
      }
    ]);
  });

  test('getRunLogs returns an invalid-path placeholder for unsafe log paths', async () => {
    getOne.mockResolvedValue({ run_id: 56, log_path: '../../outside.log' });

    await expect(adminScriptRunner.getRunLogs(56)).resolves.toEqual([
      {
        log_id: null,
        run_id: 56,
        seq: 1,
        stream: 'system',
        message: 'Run log path is invalid.',
        created_at: expect.any(String)
      }
    ]);
  });

  test('getRunLogs returns empty output for later polls after missing logs', async () => {
    getOne.mockResolvedValue({ run_id: 57, log_path: null });

    await expect(adminScriptRunner.getRunLogs(57, 1)).resolves.toEqual([]);
  });
});
