jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../round-service', () => ({
  expandRoundSelection: jest.fn()
}));

const { AppError } = require('../../utils/error-handler');
const { getQuery, getOne, runQuery } = require('../../models/db');
const roundService = require('../round-service');
const predictionService = require('../prediction-service');

describe('prediction-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('savePrediction updates an existing prediction', async () => {
    getOne.mockResolvedValue({ match_id: 1, predictor_id: 2 });
    runQuery.mockResolvedValue({ changes: 1 });

    const result = await predictionService.savePrediction(1, 2, 70);

    expect(runQuery).toHaveBeenCalledWith(
      'UPDATE predictions SET home_win_probability = ?, tipped_team = ? WHERE match_id = ? AND predictor_id = ?',
      [70, 'home', 1, 2]
    );
    expect(result).toEqual({ action: 'updated', changes: 1 });
  });

  test('savePrediction creates a new prediction when none exists', async () => {
    getOne.mockResolvedValue(null);
    runQuery.mockResolvedValue({ changes: 1 });

    const result = await predictionService.savePrediction(1, 2, 55);

    expect(runQuery).toHaveBeenCalledWith(
      'INSERT INTO predictions (match_id, predictor_id, home_win_probability, tipped_team) VALUES (?, ?, ?, ?)',
      [1, 2, 55, 'home']
    );
    expect(result).toEqual({ action: 'created', changes: 1 });
  });

  test('savePrediction preserves an away tiebreaker for 50 percent predictions', async () => {
    getOne.mockResolvedValue(null);
    runQuery.mockResolvedValue({ changes: 1 });

    await predictionService.savePrediction(1, 2, 50, { tippedTeam: 'away' });

    expect(runQuery).toHaveBeenCalledWith(
      'INSERT INTO predictions (match_id, predictor_id, home_win_probability, tipped_team) VALUES (?, ?, ?, ?)',
      [1, 2, 50, 'away']
    );
  });

  test('savePrediction rejects invalid probability values', async () => {
    await expect(predictionService.savePrediction(1, 2, 101)).rejects.toMatchObject({
      message: 'Probability must be between 0 and 100',
      statusCode: 400
    });
  });

  test('savePrediction rejects missing required fields', async () => {
    await expect(predictionService.savePrediction(null, 2, 50)).rejects.toMatchObject({
      message: 'Match ID, predictor ID, and probability are required',
      statusCode: 400
    });
  });

  test('savePrediction wraps unexpected database failures', async () => {
    getOne.mockRejectedValue(new Error('db write failed'));

    await expect(predictionService.savePrediction(1, 2, 50)).rejects.toEqual(
      expect.objectContaining(new AppError('Failed to save prediction', 500, 'DATABASE_ERROR'))
    );
  });

  test('deletePrediction raises not found when no row is deleted', async () => {
    runQuery.mockResolvedValue({ changes: 0 });

    await expect(predictionService.deletePrediction(1, 2)).rejects.toMatchObject({
      message: 'Prediction not found',
      statusCode: 404
    });
  });

  test('deletePrediction rejects missing ids', async () => {
    await expect(predictionService.deletePrediction(null, 2)).rejects.toMatchObject({
      message: 'Match ID and predictor ID are required',
      statusCode: 400
    });
  });

  test('deletePrediction returns the affected row count on success', async () => {
    runQuery.mockResolvedValue({ changes: 1 });

    await expect(predictionService.deletePrediction(1, 2)).resolves.toEqual({ changes: 1 });
  });

  test('deletePrediction wraps unexpected database failures', async () => {
    runQuery.mockRejectedValue(new Error('db delete failed'));

    await expect(predictionService.deletePrediction(1, 2)).rejects.toEqual(
      expect.objectContaining(new AppError('Failed to delete prediction', 500, 'DATABASE_ERROR'))
    );
  });

  test('getAllPredictionsWithDetails returns joined prediction rows', async () => {
    const rows = [{ predictor_name: 'Dad', match_number: 14 }];
    getQuery.mockResolvedValue(rows);

    await expect(predictionService.getAllPredictionsWithDetails()).resolves.toBe(rows);
    expect(getQuery).toHaveBeenCalledWith(expect.stringContaining('JOIN predictors'));
  });

  test('getAllPredictionsWithDetails wraps query failures', async () => {
    getQuery.mockRejectedValue(new Error('db down'));

    await expect(predictionService.getAllPredictionsWithDetails()).rejects.toEqual(
      expect.objectContaining(new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR'))
    );
  });

  test('getPredictionsWithResultsForYear returns completed-match predictions', async () => {
    const rows = [{ match_id: 1, hscore: 80, ascore: 70 }];
    getQuery.mockResolvedValue(rows);

    await expect(predictionService.getPredictionsWithResultsForYear(2, 2026)).resolves.toBe(rows);
    expect(getQuery).toHaveBeenCalledWith(expect.stringContaining('AND m.year = ?'), [2, 2026]);
  });

  test('getPredictionsWithResultsForRound returns round-filtered predictions', async () => {
    const rows = [{ match_id: 1, round_number: '1' }];
    getQuery.mockResolvedValue(rows);

    await expect(predictionService.getPredictionsWithResultsForRound(2, 2026, '1')).resolves.toBe(rows);
    expect(getQuery).toHaveBeenCalledWith(expect.stringContaining('AND m.year = ? AND m.round_number = ?'), [2, 2026, '1']);
  });

  test('getPredictionsWithResultsForRoundSelection queries all resolved source rounds', async () => {
    const rows = [{ match_id: 1, round_number: 'Elimination Final' }];
    roundService.expandRoundSelection.mockReturnValue(['Elimination Final', 'Qualifying Final']);
    getQuery.mockResolvedValue(rows);

    await expect(
      predictionService.getPredictionsWithResultsForRoundSelection(2, 2026, 'Finals Week 2')
    ).resolves.toBe(rows);
    expect(getQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND m.round_number IN (?, ?)'),
      [2, 2026, 'Elimination Final', 'Qualifying Final']
    );
  });

  test('getPredictionsWithResultsForRoundSelection wraps database failures', async () => {
    roundService.expandRoundSelection.mockReturnValue(['Semi Final']);
    getQuery.mockRejectedValue(new Error('db down'));

    await expect(
      predictionService.getPredictionsWithResultsForRoundSelection(2, 2026, 'Semi Final')
    ).rejects.toEqual(expect.objectContaining(
      new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR')
    ));
  });

  test('getPredictionsWithResultsForRoundSelection returns an empty list when no rounds resolve', async () => {
    roundService.expandRoundSelection.mockReturnValue([]);

    const result = await predictionService.getPredictionsWithResultsForRoundSelection(2, 2026, 'Finals Week 2');

    expect(result).toEqual([]);
    expect(getQuery).not.toHaveBeenCalled();
  });

  test('getPredictionsForUser wraps database failures', async () => {
    getQuery.mockRejectedValue(new Error('db down'));

    await expect(predictionService.getPredictionsForUser(2)).rejects.toEqual(
      expect.objectContaining(new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR'))
    );
  });

  test('getPredictionsForUser returns the user predictions', async () => {
    const rows = [{ match_id: 1, predictor_id: 2 }];
    getQuery.mockResolvedValue(rows);

    await expect(predictionService.getPredictionsForUser(2)).resolves.toBe(rows);
    expect(getQuery).toHaveBeenCalledWith(
      'SELECT * FROM predictions WHERE predictor_id = ?',
      [2]
    );
  });
});
