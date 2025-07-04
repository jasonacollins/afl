const express = require('express');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated } = require('./auth');
const scoringService = require('../services/scoring-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');
const { catchAsync, createValidationError, createNotFoundError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

// Require authentication for all prediction routes
router.use(isAuthenticated);

// Get predictions page
router.get('/', catchAsync(async (req, res) => {
  // Get the selected year or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
  
  // Get all available years
  let yearQuery = 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
  // Get the user's year_joined
  const user = await predictorService.getPredictorById(req.session.user.id);
  const userYearJoined = user.year_joined || 2022;
  
  // Filter years based on when the user joined
  yearQuery = `SELECT DISTINCT year FROM matches WHERE year >= ${userYearJoined} ORDER BY year DESC`;
  const years = await getQuery(yearQuery);
      
  // Get all rounds for the selected year
  const allRounds = await roundService.getRoundsForYear(selectedYear);
  
  // Get all matches for the year to determine round completion status
  const allMatchesQuery = `
    SELECT m.*, 
       t1.name as home_team, 
       t2.name as away_team,
       m.round_number
    FROM matches m
    JOIN teams t1 ON m.home_team_id = t1.team_id
    JOIN teams t2 ON m.away_team_id = t2.team_id
    WHERE m.year = ? 
    ORDER BY m.match_date
  `;
  const allMatches = await getQuery(allMatchesQuery, [selectedYear]);
  
  // Group matches by round
  const matchesByRound = {};
  allMatches.forEach(match => {
    if (!matchesByRound[match.round_number]) {
      matchesByRound[match.round_number] = [];
    }
    matchesByRound[match.round_number].push(match);
  });
  
  // Add completion status to rounds and determine current round
  let currentRound = null;
  const rounds = allRounds.map(roundObj => {
    const roundNumber = roundObj.round_number;
    const roundMatches = matchesByRound[roundNumber] || [];
    
    // Check if all matches in this round are completed
    const allMatchesCompleted = roundMatches.length > 0 && 
      roundMatches.every(match => match.hscore !== null && match.ascore !== null);
    
    // If this round is not completed and we haven't found current round yet
    if (!allMatchesCompleted && !currentRound) {
      currentRound = roundNumber;
    }
    
    return {
      ...roundObj,
      isCompleted: allMatchesCompleted
    };
  });
  
  // Find the earliest round with incomplete matches (where complete != 100)
  let selectedRound = null;
  if (!req.query.round) { // Only auto-select if round not specified in URL
    const incompleteRound = await getOne(
      `SELECT m.round_number 
       FROM matches m 
       WHERE m.year = ? AND (m.complete IS NULL OR m.complete != 100)
       ORDER BY ${roundService.ROUND_ORDER_SQL},
       m.match_date
       LIMIT 1`,
      [selectedYear]
    );
    
    if (incompleteRound) {
      selectedRound = incompleteRound.round_number;
    }
  }
  
  // If no incomplete round found or round is specified in query, use the first round or query parameter
  if (!selectedRound) {
    selectedRound = req.query.round || (rounds.length > 0 ? rounds[0].round_number : null);
  }
  
  // Get matches for the selected round AND year
  let matches = [];
  if (selectedRound) {
    matches = await matchService.getMatchesByRoundAndYear(selectedRound, selectedYear);
    matches = matchService.processMatchLockStatus(matches);
  }
  
  // Get user predictions
  const predictorId = req.session.user.id;
  const userPredictions = await predictionService.getPredictionsForUser(req.session.user.id);
  
  // Create predictions map
  const predictionsMap = {};
  userPredictions.forEach(pred => {
    predictionsMap[pred.match_id] = pred.home_win_probability;
  });
  
  logger.info(`User ${req.session.user.id} viewing predictions for year ${selectedYear}, round ${selectedRound}`);
  
  res.render('predictions', {
    years,
    selectedYear,
    rounds,
    selectedRound,
    currentRound,
    matches,
    predictions: predictionsMap,
    calculateTipPoints: scoringService.calculateTipPoints,
    calculateBrierScore: scoringService.calculateBrierScore,
    calculateBitsScore: scoringService.calculateBitsScore
  });
}));

// Get matches for a specific round (AJAX)
router.get('/round/:round', catchAsync(async (req, res) => {
  const round = req.params.round;
  const year = req.query.year || new Date().getFullYear();
  
  const matches = await matchService.getMatchesByRoundAndYear(round, year);
  const processedMatches = matchService.processMatchLockStatus(matches);
  
  logger.debug(`Fetched ${matches.length} matches for round ${round}, year ${year}`);
  
  res.json(processedMatches);
}));

// Save prediction
router.post('/save', catchAsync(async (req, res) => {
  const { matchId, probability } = req.body;
  const predictorId = req.session.user.id;
  
  if (!matchId || probability === undefined) {
    throw createValidationError('Missing required fields');
  }
  
  // Check if match is locked
  const match = await getOne(
    `SELECT m.match_date FROM matches m WHERE m.match_id = ?`,
    [matchId]
  );

  if (!match) {
    throw createNotFoundError('Match');
  }

  // Only perform lock check for non-admin users
  if (!req.session.isAdmin && match.match_date) {
    try {
      const matchDate = new Date(match.match_date);
      if (new Date() > matchDate) {
        throw createValidationError('This match has started and predictions are locked');
      }
    } catch (error) {
      logger.error('Error parsing match date', { 
        matchId, 
        date: match.match_date, 
        error: error.message 
      });
      throw createValidationError('Invalid match date format');
    }
  }
  
  // Check if this is a deletion request (empty string or null)
  if (probability === "" || probability === null) {
    await predictionService.deletePrediction(matchId, predictorId);
    logger.info(`Prediction deleted`, { userId: predictorId, matchId });
    return res.json({ success: true, action: 'deleted' });
  }

  // Sanitize probability value
  let prob = parseInt(probability);
  if (isNaN(prob)) prob = 50;
  if (prob < 0) prob = 0;
  if (prob > 100) prob = 100;
  
  await predictionService.savePrediction(matchId, predictorId, prob);
  
  logger.info(`Prediction saved`, { 
    userId: predictorId, 
    matchId, 
    probability: prob 
  });
  
  res.json({ success: true });
}));

module.exports = router;