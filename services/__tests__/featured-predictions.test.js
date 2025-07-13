
jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../../utils/error-handler', () => ({
  AppError: class AppError extends Error { /* mock */ },
}));
jest.mock('../match-service');
jest.mock('../prediction-service');
jest.mock('../predictor-service');
jest.mock('../scoring-service');

const { getQuery, getOne } = require('../../models/db');
const matchService = require('../match-service');
const predictionService = require('../prediction-service');
const predictorService = require('../predictor-service');
const scoringService = require('../scoring-service');
const featuredPredictions = require('../featured-predictions');

describe('Featured Predictions Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getHomepageAvailablePredictorIds', () => {
    it('should return homepage available predictor IDs', async () => {
      getQuery.mockResolvedValue([{ predictor_id: 1 }, { predictor_id: 2 }]);
      const ids = await featuredPredictions.getHomepageAvailablePredictorIds();
      expect(ids).toEqual(['1', '2']);
      expect(getQuery).toHaveBeenCalledWith('SELECT predictor_id FROM predictors WHERE homepage_available = 1 ORDER BY display_name');
    });

    it('should return empty array on database error', async () => {
      getQuery.mockRejectedValue(new Error('DB Error'));
      const ids = await featuredPredictions.getHomepageAvailablePredictorIds();
      expect(ids).toEqual([]);
    });
  });

  describe('getDefaultFeaturedPredictorId', () => {
    it('should return the default featured predictor ID', async () => {
      getOne.mockResolvedValue({ predictor_id: 123 });
      const id = await featuredPredictions.getDefaultFeaturedPredictorId();
      expect(id).toBe(123);
      expect(getOne).toHaveBeenCalledWith('SELECT predictor_id FROM predictors WHERE is_default_featured = 1');
    });

    it('should fall back to first homepage available if no default is set', async () => {
      getOne.mockResolvedValueOnce(null); // No default
      getOne.mockResolvedValueOnce({ predictor_id: 456 }); // First available
      const id = await featuredPredictions.getDefaultFeaturedPredictorId();
      expect(id).toBe(456);
    });

    it('should return null if no predictors exist', async () => {
      getOne.mockResolvedValue(null);
      const id = await featuredPredictions.getDefaultFeaturedPredictorId();
      expect(id).toBe(null);
    });

    it('should return null on database error', async () => {
      getOne.mockRejectedValue(new Error('DB Error'));
      const id = await featuredPredictions.getDefaultFeaturedPredictorId();
      expect(id).toBe(null);
    });
  });

  describe('getDefaultFeaturedPredictor', () => {
    it('should return predictor details for the default featured predictor', async () => {
      const mockPredictor = { id: 'predictor-123', name: 'Test Predictor' };
      getOne.mockResolvedValue({ predictor_id: 'predictor-123' });
      predictorService.getPredictorById.mockResolvedValue(mockPredictor);

      const predictor = await featuredPredictions.getDefaultFeaturedPredictor();

      expect(predictor).toEqual(mockPredictor);
      expect(predictorService.getPredictorById).toHaveBeenCalledWith('predictor-123');
    });

    it('should return null if no default featured predictor is found', async () => {
      getOne.mockResolvedValue(null);
      const predictor = await featuredPredictions.getDefaultFeaturedPredictor();
      expect(predictor).toBe(null);
    });
  });

  describe('getPredictionsForRound', () => {
    it('should return a full prediction object with calculated metrics', async () => {
      // Arrange: Mock all dependencies
      const mockPredictor = { predictor_id: 'pred-1', name: 'The Predictor' };
      const mockMatches = [
        { match_id: 1, hscore: 100, ascore: 80 }, // Completed match
        { match_id: 2, hscore: null, ascore: null }, // Future match
      ];
      const mockPredictions = [
        { match_id: 1, home_win_probability: 0.75, tipped_team: 'home' },
      ];

      predictorService.getPredictorById.mockResolvedValue(mockPredictor);
      matchService.getMatchesByRoundAndYear.mockResolvedValue(mockMatches);
      predictionService.getPredictionsForUser.mockResolvedValue(mockPredictions);
      
      // Mock scoring calculations
      scoringService.calculateTipPoints.mockReturnValue(1);
      scoringService.calculateBrierScore.mockReturnValue(0.1);
      scoringService.calculateBitsScore.mockReturnValue(0.5);

      // Act
      const result = await featuredPredictions.getPredictionsForRound('pred-1', 1, 2024);

      // Assert
      expect(result.predictor).toEqual(mockPredictor);
      expect(result.matches.length).toBe(2);
      expect(result.predictions[1].probability).toBe(0.75);
      
      // Check that metrics were added to the completed match
      const completedMatch = result.matches.find(m => m.match_id === 1);
      expect(completedMatch.metrics).toBeDefined();
      expect(completedMatch.metrics.tipPoints).toBe(1);
      expect(completedMatch.metrics.brierScore).toBe(0.1);
      expect(completedMatch.metrics.bitsScore).toBe(0.5);
      expect(completedMatch.metrics.correct).toBe(true);

      // Check that metrics were NOT added to the future match
      const futureMatch = result.matches.find(m => m.match_id === 2);
      expect(futureMatch.metrics).toBeUndefined();
    });

    it('should return empty object if no predictor ID is provided', async () => {
      const result = await featuredPredictions.getPredictionsForRound(null, 1, 2024);
      expect(result.predictor).toBe(null);
      expect(result.matches).toEqual([]);
      expect(Object.keys(result.predictions).length).toBe(0);
    });

    it('should throw AppError on failure', async () => {
      predictorService.getPredictorById.mockRejectedValue(new Error('Predictor DB Error'));

      await expect(featuredPredictions.getPredictionsForRound('pred-1', 1, 2024)).rejects.toThrow();
    });
  });
});
