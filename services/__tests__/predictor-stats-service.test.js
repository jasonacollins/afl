const predictorStatsService = require('../predictor-stats-service');

describe('predictor-stats-service', () => {
  test('calculates aggregate predictor stats with margin error', () => {
    const stats = predictorStatsService.calculatePredictorStats(
      { predictor_id: 7, name: 'model', display_name: 'Model' },
      [
        {
          home_win_probability: 60,
          hscore: 90,
          ascore: 80,
          tipped_team: 'home',
          predicted_margin: 15
        },
        {
          home_win_probability: 40,
          hscore: 70,
          ascore: 75,
          tipped_team: 'away',
          predicted_margin: null
        }
      ],
      { bitsScoreDigits: 2 }
    );

    expect(stats).toEqual(expect.objectContaining({
      id: 7,
      tipPoints: 2,
      totalPredictions: 2,
      tipAccuracy: '100.0',
      brierScore: '0.1600',
      bitsScore: '0.53',
      marginMAE: '5.00',
      marginPredictionCount: 1
    }));
  });

  test('filters round-scoped predictor stats and excludes admin predictors from sorting', () => {
    const predictors = [
      { predictor_id: 1, name: 'member', display_name: 'Member', is_admin: 0 },
      { predictor_id: 2, name: 'admin', display_name: 'Admin', is_admin: 1 }
    ];
    const predictorPredictions = new Map([
      [1, [
        { round_number: '1', home_win_probability: 60, hscore: 90, ascore: 80 },
        { round_number: '2', home_win_probability: 30, hscore: 90, ascore: 80 }
      ]],
      [2, [
        { round_number: '1', home_win_probability: 60, hscore: 90, ascore: 80 }
      ]]
    ]);

    const stats = predictorStatsService.buildPredictorStats(predictors, predictorPredictions, {
      sourceRounds: ['1']
    });
    const filteredStats = predictorStatsService.filterAndSortPredictorStats(stats, predictors);

    expect(filteredStats).toHaveLength(1);
    expect(filteredStats[0]).toEqual(expect.objectContaining({
      id: 1,
      tipPoints: 1,
      totalPredictions: 1
    }));
  });

  test('builds CSV export with escaped text fields and preserved zero scores', () => {
    const csv = predictorStatsService.buildPredictionExportCsv([
      {
        predictor_name: 'Model "A"',
        round_number: '1',
        match_number: 2,
        match_date: '2026-03-20T09:30:00.000Z',
        home_team: 'Cats, FC',
        away_team: 'Swans',
        home_win_probability: 50,
        tipped_team: 'home',
        hscore: 0,
        ascore: 12
      }
    ]);

    expect(csv).toContain('"Model ""A"""');
    expect(csv).toContain('"Cats, FC"');
    expect(csv).toContain(',0,12,');
    expect(csv).toContain('"No",0.0,0.2500,0.0000');
  });
});
