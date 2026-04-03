jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('../../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  initializeDatabase: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const syncGamesModule = require('../sync-games');

const {
  resolveSquiggleTeamIds,
  resolveRoundNumber,
  resolveMatchDate,
  normalizeCompletion,
  normalizeScorePayload
} = syncGamesModule.__testables;

describe('sync-games normalization helpers', () => {
  test('maps TBA finals teams to placeholder ids', () => {
    expect(resolveSquiggleTeamIds({
      hteam: 'To be announced',
      ateam: 'TO BE ANNOUNCED'
    })).toEqual({
      homeTeamId: 99,
      awayTeamId: 99
    });
  });

  test('preserves explicit team ids when present', () => {
    expect(resolveSquiggleTeamIds({
      hteamid: 5,
      ateamid: 9,
      hteam: 'To be announced',
      ateam: 'To be announced'
    })).toEqual({
      homeTeamId: 5,
      awayTeamId: 9
    });
  });

  test('maps opening round and explicit finals labels correctly', () => {
    expect(resolveRoundNumber({ round: 0, roundname: 'Opening Round', is_final: 0 })).toBe('OR');
    expect(resolveRoundNumber({ round: 25, roundname: 'Wildcard Finals', is_final: 1 })).toBe('Wildcard Finals');
    expect(resolveRoundNumber({ round: 26, roundname: 'Qualifying Final', is_final: 3 })).toBe('Qualifying Final');
  });

  test('falls back to Squiggle finals numeric codes when round names are generic', () => {
    expect(resolveRoundNumber({ round: 25, roundname: 'Finals', is_final: 4 })).toBe('Semi Final');
    expect(resolveRoundNumber({ round: 28, roundname: 'Finals', is_final: 6 })).toBe('Grand Final');
  });

  test('keeps regular season rounds numeric when not finals', () => {
    expect(resolveRoundNumber({ round: 7, roundname: 'Round 7', is_final: 0 })).toBe('7');
  });

  test('resolves match date from unix time before date strings', () => {
    expect(resolveMatchDate({
      unixtime: 1772236800,
      date: '2020-01-01T00:00:00Z'
    })).toBe('2026-02-28T00:00:00.000Z');
    expect(resolveMatchDate({ date: '2026-03-20T09:30:00Z' })).toBe('2026-03-20T09:30:00.000Z');
    expect(resolveMatchDate({})).toBeNull();
  });

  test('normalizes invalid completion values to zero', () => {
    expect(normalizeCompletion(undefined)).toBe(0);
    expect(normalizeCompletion('abc')).toBe(0);
    expect(normalizeCompletion(101)).toBe(0);
    expect(normalizeCompletion('100')).toBe(100);
  });

  test('nulls future incomplete zero-zero placeholders', () => {
    const result = normalizeScorePayload(
      {
        hscore: 0,
        ascore: 0,
        hgoals: 0,
        hbehinds: 0,
        agoals: 0,
        abehinds: 0
      },
      '2099-03-20T09:30:00.000Z',
      0,
      new Date('2026-04-03T00:00:00.000Z')
    );

    expect(result).toEqual({
      homeScore: null,
      awayScore: null,
      homeGoals: null,
      homeBehinds: null,
      awayGoals: null,
      awayBehinds: null
    });
  });

  test('preserves completed scores even when they are zero', () => {
    const result = normalizeScorePayload(
      {
        hscore: 0,
        ascore: 0,
        hgoals: 0,
        hbehinds: 0,
        agoals: 0,
        abehinds: 0
      },
      '2026-03-20T09:30:00.000Z',
      100,
      new Date('2026-04-03T00:00:00.000Z')
    );

    expect(result).toEqual({
      homeScore: 0,
      awayScore: 0,
      homeGoals: null,
      homeBehinds: null,
      awayGoals: null,
      awayBehinds: null
    });
  });
});
