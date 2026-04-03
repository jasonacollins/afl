const mockGetQuery = jest.fn();

jest.mock('../../../models/db', () => ({
  getQuery: (...args) => mockGetQuery(...args)
}));

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}));

jest.mock('../api-refresh', () => ({
  refreshAPIData: jest.fn()
}));

jest.mock('../elo-predictions', () => ({
  runEloPredictions: jest.fn()
}));

jest.mock('../sync-games', () => ({
  syncGamesFromAPI: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const {
  buildRoundSnapshotMetadata,
  buildCurrentRoundSnapshotMetadata,
  determineCurrentRoundSnapshotMetadata,
  buildPostSeasonSnapshotMetadata,
  hasCompletedResultChanges,
  regenerateEloHistory,
  regenerateSeasonSimulation,
  runFallbackReconciliation
} = require('../daily-sync');
const { refreshAPIData } = require('../api-refresh');
const { runEloPredictions } = require('../elo-predictions');
const { syncGamesFromAPI } = require('../sync-games');
const { spawn } = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');

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

describe('daily-sync round snapshot metadata', () => {
  beforeEach(() => {
    mockGetQuery.mockReset();
  });

  test('buildCurrentRoundSnapshotMetadata returns OR current metadata', () => {
    const metadata = buildCurrentRoundSnapshotMetadata('OR');

    expect(metadata.roundKey).toBe('round-or-current');
    expect(metadata.roundTabLabel).toBe('Current');
    expect(metadata.roundLabel).toBe('Current Opening Round');
  });

  test('buildCurrentRoundSnapshotMetadata returns numeric current metadata', () => {
    const metadata = buildCurrentRoundSnapshotMetadata('2');

    expect(metadata.roundKey).toBe('round-2-current');
    expect(metadata.roundTabLabel).toBe('Current');
    expect(metadata.roundLabel).toBe('Current Round 2');
  });

  test('buildRoundSnapshotMetadata keeps before-round metadata unchanged', () => {
    const metadata = buildRoundSnapshotMetadata('1');

    expect(metadata.roundKey).toBe('round-1');
    expect(metadata.roundTabLabel).toBe('R1');
    expect(metadata.roundLabel).toBe('Before Round 1');
  });

  test('determineCurrentRoundSnapshotMetadata returns current key for partial round', async () => {
    mockGetQuery.mockResolvedValue([
      {
        match_id: 1,
        match_number: 1,
        round_number: 'OR',
        match_date: '2026-03-05 19:30:00',
        complete: 100,
        hscore: 80,
        ascore: 70
      },
      {
        match_id: 2,
        match_number: 2,
        round_number: 'OR',
        match_date: '2026-03-06 20:05:00',
        complete: 0,
        hscore: null,
        ascore: null
      },
      {
        match_id: 3,
        match_number: 3,
        round_number: '1',
        match_date: '2026-03-12 19:30:00',
        complete: 0,
        hscore: null,
        ascore: null
      }
    ]);

    const metadata = await determineCurrentRoundSnapshotMetadata(2026);

    expect(metadata.roundKey).toBe('round-or-current');
    expect(metadata.roundLabel).toBe('Current Opening Round');
    expect(metadata.roundTabLabel).toBe('Current');
  });

  test('determineCurrentRoundSnapshotMetadata returns next before-round key when round not started', async () => {
    mockGetQuery.mockResolvedValue([
      {
        match_id: 1,
        match_number: 1,
        round_number: 'OR',
        match_date: '2026-03-05 19:30:00',
        complete: 100,
        hscore: 80,
        ascore: 70
      },
      {
        match_id: 2,
        match_number: 2,
        round_number: '1',
        match_date: '2026-03-12 19:30:00',
        complete: 0,
        hscore: null,
        ascore: null
      }
    ]);

    const metadata = await determineCurrentRoundSnapshotMetadata(2026);

    expect(metadata.roundKey).toBe('round-1');
    expect(metadata.roundLabel).toBe('Before Round 1');
    expect(metadata.roundTabLabel).toBe('R1');
  });

  test('determineCurrentRoundSnapshotMetadata returns numeric current key for partial round', async () => {
    mockGetQuery.mockResolvedValue([
      {
        match_id: 10,
        match_number: 10,
        round_number: '1',
        match_date: '2026-03-12 19:30:00',
        complete: 100,
        hscore: 101,
        ascore: 92
      },
      {
        match_id: 11,
        match_number: 11,
        round_number: '2',
        match_date: '2026-03-19 19:30:00',
        complete: 100,
        hscore: 88,
        ascore: 79
      },
      {
        match_id: 12,
        match_number: 12,
        round_number: '2',
        match_date: '2026-03-20 19:40:00',
        complete: 0,
        hscore: null,
        ascore: null
      }
    ]);

    const metadata = await determineCurrentRoundSnapshotMetadata(2026);

    expect(metadata.roundKey).toBe('round-2-current');
    expect(metadata.roundLabel).toBe('Current Round 2');
    expect(metadata.roundTabLabel).toBe('Current');
  });

  test('determineCurrentRoundSnapshotMetadata returns opening round metadata when no matches exist', async () => {
    mockGetQuery.mockResolvedValue([]);

    const metadata = await determineCurrentRoundSnapshotMetadata(2026);

    expect(metadata).toEqual(buildRoundSnapshotMetadata('OR'));
  });

  test('determineCurrentRoundSnapshotMetadata returns post-season metadata when all matches complete', async () => {
    mockGetQuery.mockResolvedValue([
      {
        match_id: 1,
        match_number: 1,
        round_number: 'Grand Final',
        match_date: '2026-09-26 14:30:00',
        complete: 100,
        hscore: 95,
        ascore: 82
      }
    ]);

    const metadata = await determineCurrentRoundSnapshotMetadata(2026);

    expect(metadata).toEqual(buildPostSeasonSnapshotMetadata());
  });
});

describe('daily-sync completed result detection', () => {
  test('returns true when api-refresh reports score updates', () => {
    expect(hasCompletedResultChanges({ scoresUpdated: 2 }, {})).toBe(true);
  });

  test('returns true when sync-games inserts completed matches', () => {
    expect(
      hasCompletedResultChanges(
        { scoresUpdated: 0 },
        { completedInsertCount: 3, completedUpdateCount: 0 }
      )
    ).toBe(true);
  });

  test('returns true when sync-games marks existing matches complete', () => {
    expect(
      hasCompletedResultChanges(
        { scoresUpdated: 0 },
        { completedInsertCount: 0, completedUpdateCount: 1 }
      )
    ).toBe(true);
  });

  test('returns false when there are no completed-result changes', () => {
    expect(
      hasCompletedResultChanges(
        { scoresUpdated: 0 },
        { completedInsertCount: 0, completedUpdateCount: 0 }
      )
    ).toBe(false);
  });
});

describe('daily-sync automation orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQuery.mockReset();
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockImplementation(() => {
      throw new Error('Unexpected readFileSync call');
    });
  });

  test('regenerateEloHistory spawns the history generator and resolves on success', async () => {
    spawn.mockImplementation(() => queueChildResult({ stdout: ['history ok\n'] }));

    await expect(regenerateEloHistory({ mode: 'incremental' })).resolves.toEqual({
      success: true,
      message: 'ELO history updated'
    });

    expect(spawn).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        'scripts/elo_history_generator.py',
        '--mode',
        'incremental',
        '--output-prefix',
        'afl_elo_complete_history'
      ]),
      expect.objectContaining({
        cwd: expect.stringContaining('/afl')
      })
    );
  });

  test('regenerateSeasonSimulation rejects when the simulator exits non-zero', async () => {
    spawn.mockImplementation(() => queueChildResult({ code: 1, stderr: ['sim failed'] }));

    await expect(regenerateSeasonSimulation(2026)).rejects.toThrow(
      'Season simulation generator failed with code 1: sim failed'
    );
  });

  test('runFallbackReconciliation performs full recompute when completed results are detected', async () => {
    const currentYear = new Date().getFullYear();

    mockGetQuery.mockResolvedValue([]);
    syncGamesFromAPI.mockResolvedValue({
      insertCount: 0,
      updateCount: 0,
      skipCount: 0,
      completedInsertCount: 1,
      completedUpdateCount: 0
    });
    refreshAPIData.mockResolvedValue({
      insertCount: 0,
      updateCount: 0,
      scoresUpdated: 0
    });
    runEloPredictions.mockResolvedValue({
      message: 'Predictions updated',
      predictionsCount: 12
    });
    spawn
      .mockImplementationOnce(() => queueChildResult())
      .mockImplementationOnce(() => queueChildResult());

    const result = await runFallbackReconciliation(currentYear, { source: 'test-suite' });

    expect(syncGamesFromAPI).toHaveBeenCalledWith({ year: currentYear });
    expect(refreshAPIData).toHaveBeenCalledWith(currentYear, {
      forceScoreUpdate: false,
      source: 'test-suite'
    });
    expect(runEloPredictions).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'python3',
      expect.arrayContaining([
        'scripts/season_simulator.py',
        '--year',
        String(currentYear)
      ]),
      expect.any(Object)
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'python3',
      expect.arrayContaining([
        'scripts/elo_history_generator.py',
        '--mode',
        'incremental'
      ]),
      expect.any(Object)
    );
    expect(result).toEqual(expect.objectContaining({
      source: 'test-suite',
      year: currentYear,
      resultChangesDetected: true,
      recomputeResults: expect.objectContaining({
        eloResults: expect.objectContaining({ predictionsCount: 12 }),
        historyResults: { success: true, message: 'ELO history updated' }
      })
    }));
  });

  test('runFallbackReconciliation refreshes predictions and simulation for fixture-only changes', async () => {
    const currentYear = new Date().getFullYear();

    mockGetQuery.mockResolvedValue([]);
    syncGamesFromAPI.mockResolvedValue({
      insertCount: 1,
      updateCount: 0,
      skipCount: 0,
      completedInsertCount: 0,
      completedUpdateCount: 0
    });
    refreshAPIData.mockResolvedValue({
      insertCount: 0,
      updateCount: 0,
      scoresUpdated: 0
    });
    runEloPredictions.mockResolvedValue({
      message: 'Predictions updated',
      predictionsCount: 7
    });
    fs.existsSync.mockImplementation((targetPath) => {
      const normalizedPath = String(targetPath);
      if (normalizedPath.endsWith(`season_simulation_${currentYear}.json`)) {
        return true;
      }
      if (normalizedPath.endsWith('afl_elo_complete_history.csv')) {
        return true;
      }
      return false;
    });
    fs.readFileSync.mockReturnValue(JSON.stringify({
      year: currentYear,
      round_snapshots: [{ round_key: 'round-or' }]
    }));
    spawn.mockImplementation(() => queueChildResult());

    const result = await runFallbackReconciliation(currentYear, { source: 'fixture-only' });

    expect(runEloPredictions).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        'scripts/season_simulator.py',
        '--year',
        String(currentYear)
      ]),
      expect.any(Object)
    );
    expect(result).toEqual(expect.objectContaining({
      source: 'fixture-only',
      year: currentYear,
      matchDataChanged: true,
      resultChangesDetected: false,
      recomputeResults: expect.objectContaining({
        eloResults: expect.objectContaining({ predictionsCount: 7 }),
        historyResults: null
      })
    }));
  });

  test('runFallbackReconciliation skips recompute when nothing changed and the snapshot exists', async () => {
    const currentYear = new Date().getFullYear();

    mockGetQuery.mockResolvedValue([]);
    syncGamesFromAPI.mockResolvedValue({
      insertCount: 0,
      updateCount: 0,
      skipCount: 0,
      completedInsertCount: 0,
      completedUpdateCount: 0
    });
    refreshAPIData.mockResolvedValue({
      insertCount: 0,
      updateCount: 0,
      scoresUpdated: 0
    });
    fs.existsSync.mockImplementation((targetPath) => {
      const normalizedPath = String(targetPath);
      return normalizedPath.endsWith(`season_simulation_${currentYear}.json`);
    });
    fs.readFileSync.mockReturnValue(JSON.stringify({
      year: currentYear,
      round_snapshots: [{ round_key: 'round-or' }]
    }));

    const result = await runFallbackReconciliation(currentYear, { source: 'no-change' });

    expect(runEloPredictions).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(result.recomputeResults).toBeNull();
  });
});
