const eloService = require('../elo-service');

function createMatchPair({
  matchId,
  date,
  year,
  round,
  homeTeam,
  awayTeam,
  homeBefore,
  homeAfter,
  awayBefore,
  awayAfter
}) {
  return [
    {
      match_id: String(matchId),
      date,
      year: String(year),
      round,
      team: homeTeam,
      opponent: awayTeam,
      score: '90',
      opponent_score: '80',
      result: 'win',
      rating_before: String(homeBefore),
      rating_after: String(homeAfter),
      rating_change: String(homeAfter - homeBefore),
      venue: 'Test Venue'
    },
    {
      match_id: String(matchId),
      date,
      year: String(year),
      round,
      team: awayTeam,
      opponent: homeTeam,
      score: '80',
      opponent_score: '90',
      result: 'loss',
      rating_before: String(awayBefore),
      rating_after: String(awayAfter),
      rating_change: String(awayAfter - awayBefore),
      venue: 'Test Venue'
    }
  ];
}

describe('EloService season start chart points', () => {
  test('single-year mode prepends season start before Opening Round', () => {
    const rawData = [
      ...createMatchPair({
        matchId: 0,
        date: '2025-08-20 08:00:00+00:00',
        year: 2025,
        round: '24',
        homeTeam: 'Fremantle',
        awayTeam: 'Geelong',
        homeBefore: 1495,
        homeAfter: 1505,
        awayBefore: 1505,
        awayAfter: 1495
      }),
      ...createMatchPair({
        matchId: 1,
        date: '2026-03-01 08:00:00+00:00',
        year: 2026,
        round: 'OR',
        homeTeam: 'Adelaide',
        awayTeam: 'Brisbane Lions',
        homeBefore: 1510,
        homeAfter: 1520,
        awayBefore: 1490,
        awayAfter: 1480
      }),
      ...createMatchPair({
        matchId: 2,
        date: '2026-03-08 08:00:00+00:00',
        year: 2026,
        round: '1',
        homeTeam: 'Carlton',
        awayTeam: 'Essendon',
        homeBefore: 1475,
        homeAfter: 1484,
        awayBefore: 1525,
        awayAfter: 1516
      })
    ];

    const result = eloService.processEloData(rawData, 2026);

    expect(result.data[0].type).toBe('season_start');
    expect(result.data[0].round).toBe('Season start');
    expect(result.data[0].x).toBe(0);
    expect(result.data[0].Carlton).toBe(1475);
    expect(result.data[0].Essendon).toBe(1525);
    expect(result.data[0].Fremantle).toBe(1505);

    const openingRoundPoint = result.data.find(point => point.type === 'before' && point.round === 'OR');
    expect(openingRoundPoint).toBeDefined();
    expect(openingRoundPoint.x).toBe(1);
  });

  test('year-range mode adds one season-start point for each year', () => {
    const rawData = [
      ...createMatchPair({
        matchId: 9,
        date: '2024-08-15 08:00:00+00:00',
        year: 2024,
        round: '24',
        homeTeam: 'Fremantle',
        awayTeam: 'Geelong',
        homeBefore: 1490,
        homeAfter: 1500,
        awayBefore: 1510,
        awayAfter: 1500
      }),
      ...createMatchPair({
        matchId: 10,
        date: '2025-03-01 08:00:00+00:00',
        year: 2025,
        round: '1',
        homeTeam: 'Adelaide',
        awayTeam: 'Brisbane Lions',
        homeBefore: 1500,
        homeAfter: 1510,
        awayBefore: 1500,
        awayAfter: 1490
      }),
      ...createMatchPair({
        matchId: 11,
        date: '2025-03-08 08:00:00+00:00',
        year: 2025,
        round: '2',
        homeTeam: 'Carlton',
        awayTeam: 'Essendon',
        homeBefore: 1470,
        homeAfter: 1478,
        awayBefore: 1530,
        awayAfter: 1522
      }),
      ...createMatchPair({
        matchId: 12,
        date: '2026-03-02 08:00:00+00:00',
        year: 2026,
        round: 'OR',
        homeTeam: 'Adelaide',
        awayTeam: 'Brisbane Lions',
        homeBefore: 1515,
        homeAfter: 1520,
        awayBefore: 1485,
        awayAfter: 1480
      }),
      ...createMatchPair({
        matchId: 13,
        date: '2026-03-09 08:00:00+00:00',
        year: 2026,
        round: '1',
        homeTeam: 'Carlton',
        awayTeam: 'Essendon',
        homeBefore: 1472,
        homeAfter: 1480,
        awayBefore: 1528,
        awayAfter: 1520
      })
    ];

    const result = eloService.processEloDataForYearRange(rawData, 2025, 2026);
    const seasonStartPoints = result.data.filter(point => point.type === 'season_start');

    expect(seasonStartPoints).toHaveLength(2);
    expect(seasonStartPoints.map(point => point.year)).toEqual([2025, 2026]);

    const seasonStart2025 = seasonStartPoints.find(point => point.year === 2025);
    const seasonStart2026 = seasonStartPoints.find(point => point.year === 2026);
    expect(seasonStart2025.Carlton).toBe(1470);
    expect(seasonStart2026.Carlton).toBe(1472);
    expect(seasonStart2025.Fremantle).toBe(1500);
    expect(seasonStart2026.Fremantle).toBe(1500);

    const openingRound2026 = result.data.find(point => point.type === 'before' && point.year === 2026 && point.round === 'OR');
    expect(openingRound2026).toBeDefined();
    expect(seasonStart2026.x).toBeLessThan(openingRound2026.x);
  });

  test('finals week grouping remains unchanged with season-start point present', () => {
    const rawData = [
      ...createMatchPair({
        matchId: 20,
        date: '2025-09-05 08:00:00+00:00',
        year: 2025,
        round: 'Elimination Final',
        homeTeam: 'Adelaide',
        awayTeam: 'Brisbane Lions',
        homeBefore: 1550,
        homeAfter: 1560,
        awayBefore: 1450,
        awayAfter: 1440
      }),
      ...createMatchPair({
        matchId: 21,
        date: '2025-09-06 08:00:00+00:00',
        year: 2025,
        round: 'Qualifying Final',
        homeTeam: 'Carlton',
        awayTeam: 'Essendon',
        homeBefore: 1540,
        homeAfter: 1548,
        awayBefore: 1460,
        awayAfter: 1452
      })
    ];

    const result = eloService.processEloData(rawData, 2025);
    const finalsWeek1BeforePoints = result.data.filter(
      point => point.type === 'before' && point.round === 'Finals Week 1'
    );

    expect(result.data[0].type).toBe('season_start');
    expect(finalsWeek1BeforePoints).toHaveLength(2);
    expect(finalsWeek1BeforePoints[0].x).toBe(finalsWeek1BeforePoints[1].x);
  });

  test('single-year mode deduplicates duplicate team-match history rows', () => {
    const duplicateOpeningRound = createMatchPair({
      matchId: 1,
      date: '',
      year: 2025,
      round: 'OR',
      homeTeam: 'Adelaide',
      awayTeam: 'Brisbane Lions',
      homeBefore: 1500,
      homeAfter: 1512,
      awayBefore: 1500,
      awayAfter: 1488
    });
    const datedOpeningRound = createMatchPair({
      matchId: 1,
      date: '2025-03-01 08:00:00+00:00',
      year: 2025,
      round: 'OR',
      homeTeam: 'Adelaide',
      awayTeam: 'Brisbane Lions',
      homeBefore: 1500,
      homeAfter: 1512,
      awayBefore: 1500,
      awayAfter: 1488
    });
    const roundOne = createMatchPair({
      matchId: 2,
      date: '2025-03-08 08:00:00+00:00',
      year: 2025,
      round: '1',
      homeTeam: 'Carlton',
      awayTeam: 'Essendon',
      homeBefore: 1495,
      homeAfter: 1501,
      awayBefore: 1505,
      awayAfter: 1499
    });

    const result = eloService.processEloData([
      ...duplicateOpeningRound,
      ...datedOpeningRound,
      ...roundOne
    ], 2025);

    expect(result.totalMatches).toBe(2);

    const openingRoundAfterGames = result.data.filter(
      point => point.type === 'after_game' && point.round === 'OR'
    );
    expect(openingRoundAfterGames).toHaveLength(1);

    const openingRoundBeforePoint = result.data.find(
      point => point.type === 'before' && point.round === 'OR'
    );
    expect(openingRoundBeforePoint.Adelaide_match.opponent).toBe('Brisbane Lions');
  });

  test('single-year mode excludes defunct historical teams from modern season start values', () => {
    const rawData = [
      ...createMatchPair({
        matchId: 90,
        date: '1996-08-01 08:00:00+00:00',
        year: 1996,
        round: '18',
        homeTeam: 'Fitzroy',
        awayTeam: 'University',
        homeBefore: 1400,
        homeAfter: 1390,
        awayBefore: 1300,
        awayAfter: 1310
      }),
      ...createMatchPair({
        matchId: 91,
        date: '2025-03-01 08:00:00+00:00',
        year: 2025,
        round: 'OR',
        homeTeam: 'Adelaide',
        awayTeam: 'Brisbane Lions',
        homeBefore: 1500,
        homeAfter: 1510,
        awayBefore: 1500,
        awayAfter: 1490
      })
    ];

    const result = eloService.processEloData(rawData, 2025, [
      'Adelaide',
      'Brisbane Lions',
      'Carlton'
    ]);

    expect(result.teams).toEqual(['Adelaide', 'Brisbane Lions', 'Carlton']);
    expect(result.data[0].Fitzroy).toBeUndefined();
    expect(result.data[0].University).toBeUndefined();
    expect(result.data[0].Carlton).toBeUndefined();
  });

  test('year-range mode excludes teams outside the selected season range', () => {
    const rawData = [
      ...createMatchPair({
        matchId: 95,
        date: '1996-08-01 08:00:00+00:00',
        year: 1996,
        round: '18',
        homeTeam: 'Fitzroy',
        awayTeam: 'University',
        homeBefore: 1400,
        homeAfter: 1390,
        awayBefore: 1300,
        awayAfter: 1310
      }),
      ...createMatchPair({
        matchId: 96,
        date: '2025-03-01 08:00:00+00:00',
        year: 2025,
        round: 'OR',
        homeTeam: 'Adelaide',
        awayTeam: 'Brisbane Lions',
        homeBefore: 1500,
        homeAfter: 1510,
        awayBefore: 1500,
        awayAfter: 1490
      }),
      ...createMatchPair({
        matchId: 97,
        date: '2026-03-01 08:00:00+00:00',
        year: 2026,
        round: 'OR',
        homeTeam: 'Carlton',
        awayTeam: 'Essendon',
        homeBefore: 1495,
        homeAfter: 1502,
        awayBefore: 1505,
        awayAfter: 1498
      })
    ];

    const result = eloService.processEloDataForYearRange(rawData, 2025, 2026, [
      'Adelaide',
      'Brisbane Lions',
      'Carlton',
      'Essendon'
    ]);

    expect(result.teams).toEqual(['Adelaide', 'Brisbane Lions', 'Carlton', 'Essendon']);
    const seasonStart2025 = result.data.find(point => point.type === 'season_start' && point.year === 2025);
    expect(seasonStart2025.Fitzroy).toBeUndefined();
    expect(seasonStart2025.University).toBeUndefined();
  });
});
