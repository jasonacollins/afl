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

const fs = require('fs').promises;
const path = require('path');
const { getOne } = require('../../models/db');
const adminScriptRunner = require('../admin-script-runner');

const { buildScriptCommand } = adminScriptRunner.__testables;

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

describe('Admin Script Runner - persisted logs and recovery', () => {
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
