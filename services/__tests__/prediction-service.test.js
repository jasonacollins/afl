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
      'UPDATE predictions SET home_win_probability = ? WHERE match_id = ? AND predictor_id = ?',
      [70, 1, 2]
    );
    expect(result).toEqual({ action: 'updated', changes: 1 });
  });

  test('savePrediction creates a new prediction when none exists', async () => {
    getOne.mockResolvedValue(null);
    runQuery.mockResolvedValue({ changes: 1 });

    const result = await predictionService.savePrediction(1, 2, 55);

    expect(runQuery).toHaveBeenCalledWith(
      'INSERT INTO predictions (match_id, predictor_id, home_win_probability) VALUES (?, ?, ?)',
      [1, 2, 55]
    );
    expect(result).toEqual({ action: 'created', changes: 1 });
  });

  test('savePrediction rejects invalid probability values', async () => {
    await expect(predictionService.savePrediction(1, 2, 101)).rejects.toMatchObject({
      message: 'Probability must be between 0 and 100',
      statusCode: 400
    });
  });

  test('deletePrediction raises not found when no row is deleted', async () => {
    runQuery.mockResolvedValue({ changes: 0 });

    await expect(predictionService.deletePrediction(1, 2)).rejects.toMatchObject({
      message: 'Prediction not found',
      statusCode: 404
    });
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
});
