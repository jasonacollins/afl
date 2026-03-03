const express = require('express');
const router = express.Router();
const { getQuery, getOne } = require('../models/db');
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
  // Get the user's year_joined to scope available years
  const user = await predictorService.getPredictorById(req.session.user.id);
  const userYearJoined = user.year_joined || 2022;
  
  // Resolve selected year against available match data
  const { selectedYear, years } = await roundService.resolveYear(req.query.year, {
    minYear: userYearJoined
  });
      
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
  const roundsWithStatus = allRounds.map(roundObj => {
    const roundNumber = roundObj.round_number;
    const roundMatches = matchesByRound[roundNumber] || [];
    
    // Check if all matches in this round are completed
    const allMatchesCompleted = roundMatches.length > 0 && 
      roundMatches.every(match => match.hscore !== null && match.ascore !== null);
    
    return {
      ...roundObj,
      isCompleted: allMatchesCompleted
    };
  });

  const rounds = roundService.combineRoundsForDisplay(roundsWithStatus, selectedYear);
  const currentRoundObj = rounds.find(round => !round.isCompleted);
  const currentRound = currentRoundObj ? currentRoundObj.round_number : null;
  
  // Resolve default selected round based on fixture dates/results rather than the `complete` flag.
  // This is more reliable when new-season fixtures are imported before Squiggle updates completion values.
  let selectedRound = roundService.normalizeRoundForDisplay(req.query.round || null, selectedYear);
  if (!selectedRound) {
    const currentDate = new Date();
    let nextUpcomingMatch = null;

    // First priority: round containing the earliest upcoming, unplayed match.
    for (const match of allMatches) {
      if (!match.match_date) {
        continue;
      }

      try {
        const matchDate = new Date(match.match_date);
        const isUnplayed = match.hscore === null || match.ascore === null;

        if (!isNaN(matchDate.getTime()) && isUnplayed && matchDate > currentDate) {
          if (!nextUpcomingMatch || matchDate < new Date(nextUpcomingMatch.match_date)) {
            nextUpcomingMatch = match;
          }
        }
      } catch (err) {
        logger.error('Error parsing match date for round auto-selection', {
          matchDate: match.match_date,
          error: err.message
        });
      }
    }

    if (nextUpcomingMatch) {
      selectedRound = roundService.normalizeRoundForDisplay(nextUpcomingMatch.round_number, selectedYear);
    } else {
      // Second priority: most recently completed round.
      let mostRecentCompletedMatch = null;
      for (const match of allMatches) {
        if (!match.match_date || match.hscore === null || match.ascore === null) {
          continue;
        }

        try {
          const matchDate = new Date(match.match_date);
          if (!isNaN(matchDate.getTime()) &&
              (!mostRecentCompletedMatch || matchDate > new Date(mostRecentCompletedMatch.match_date))) {
            mostRecentCompletedMatch = match;
          }
        } catch (err) {
          logger.error('Error parsing match date for fallback round selection', {
            matchDate: match.match_date,
            error: err.message
          });
        }
      }

      if (mostRecentCompletedMatch) {
        selectedRound = roundService.normalizeRoundForDisplay(mostRecentCompletedMatch.round_number, selectedYear);
      }
    }
  }

  // Final fallback: first available round.
  if (!selectedRound) {
    selectedRound = rounds.length > 0 ? rounds[0].round_number : null;
  }
  
  // Get matches for the selected round AND year
  let matches = [];
  if (selectedRound) {
    matches = await matchService.getMatchesByRoundSelectionAndYear(selectedRound, selectedYear);
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
  const { selectedYear: year } = await roundService.resolveYear(req.query.year);
  const round = roundService.normalizeRoundForDisplay(req.params.round, year);
  
  const matches = await matchService.getMatchesByRoundSelectionAndYear(round, year);
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
