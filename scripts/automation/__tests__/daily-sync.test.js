const mockGetQuery = jest.fn();

jest.mock('../../../models/db', () => ({
  getQuery: (...args) => mockGetQuery(...args)
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
  buildPostSeasonSnapshotMetadata
} = require('../daily-sync');

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
