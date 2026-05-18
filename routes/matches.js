const express = require('express');
const router = express.Router();
const { getQuery } = require('../models/db');
const { isAuthenticated } = require('./auth');
const roundService = require('../services/round-service');
const roundViewService = require('../services/round-view-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorStatsService = require('../services/predictor-stats-service');
const predictorService = require('../services/predictor-service');
const { catchAsync } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

// Require authentication for all matches routes
router.use(isAuthenticated);

function getSourceRoundsForSelection(rounds, roundSelection) {
  const selectedRound = rounds.find(round => round.round_number === roundSelection);

  if (selectedRound && Array.isArray(selectedRound.source_round_numbers)) {
    return selectedRound.source_round_numbers;
  }

  return roundService.expandRoundSelection(roundSelection);
}

function getSourceRoundsThroughSelection(rounds, roundSelection) {
  const roundIndex = rounds.findIndex(round => round.round_number === roundSelection);

  if (roundIndex === -1) {
    return getSourceRoundsForSelection(rounds, roundSelection);
  }

  const sourceRounds = [];
  const seenRounds = new Set();

  rounds.slice(0, roundIndex + 1).forEach(round => {
    const roundSourceNumbers = Array.isArray(round.source_round_numbers)
      ? round.source_round_numbers
      : [round.round_number];

    roundSourceNumbers.forEach(sourceRound => {
      if (!seenRounds.has(sourceRound)) {
        seenRounds.add(sourceRound);
        sourceRounds.push(sourceRound);
      }
    });
  });

  return sourceRounds;
}

function getMissedDefaultPredictorIds(predictors) {
  return predictors
    .filter(predictor =>
      !predictor.stats_excluded &&
      !predictor.is_admin &&
      predictor.active !== 0
    )
    .map(predictor => predictor.predictor_id);
}

// Get all matches
router.get('/round/:round', catchAsync(async (req, res) => {
  const { selectedYear: year } = await roundService.resolveYear(req.query.year);
  const round = roundService.normalizeRoundForDisplay(req.params.round, year);
  
  logger.debug(`Fetching matches for round ${round}, year ${year}`);
  
  // Get matches for the specific round and year
  const matches = await matchService.getMatchesByRoundSelectionAndYear(round, year);
  
  res.json(matches);
}));

// Get all rounds
router.get('/', catchAsync(async (req, res) => {
  const minYear = req.session.isAdmin ? null : 2022;
  const { selectedYear } = await roundService.resolveYear(req.query.year, { minYear });
  
  // Get all rounds for the selected year
  const rounds = await roundService.getRoundsForYear(selectedYear);
  
  res.json(rounds);
}));

// Get stats page
router.get('/stats', catchAsync(async (req, res) => {
  const startTime = Date.now();
  
  const { selectedYear, years } = await roundService.resolveYear(req.query.year, {
    minYear: 2022
  });
  
  // Get round parameter for round-by-round stats
  const selectedRound = roundService.normalizeRoundForDisplay(req.query.round || null, selectedYear);
  
  logger.info(`Stats page accessed by user ${req.session.user.id} for year ${selectedYear}${selectedRound ? `, round ${selectedRound}` : ''}`);
  
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
  
  const rounds = roundViewService.buildDisplayRounds(allRounds, allMatches, selectedYear);
  
  // Get the most recent round with results for default selection
  const mostRecentRound = await matchService.getMostRecentRoundWithResults();
  const defaultRound = mostRecentRound && mostRecentRound.year === selectedYear
    ? roundService.normalizeRoundForDisplay(mostRecentRound.round, selectedYear)
    : null;

  // Get all predictors, but include admin status and filter out excluded ones
  const allPredictors = await predictorService.getPredictorsWithAdminStatus();
  const predictors = allPredictors.filter(predictor => !predictor.stats_excluded);
  await predictionService.ensureMissedPredictionsForPredictorsAndYear(
    getMissedDefaultPredictorIds(allPredictors),
    selectedYear
  );

  // Get matches with results for the selected year
  const completedMatches = await matchService.getCompletedMatchesForYear(selectedYear);

  // Get current user's predictions for completed matches in the selected year
  const userPredictions = await predictionService.getPredictionsForUser(req.session.user.id);

  const predictorPredictions = new Map(await Promise.all(
    predictors.map(async predictor => ([
      predictor.predictor_id,
      await predictionService.getPredictionsWithResultsForYear(predictor.predictor_id, selectedYear)
    ]))
  ));

  const predictorStats = predictorStatsService.buildPredictorStats(predictors, predictorPredictions, {
    includeInactiveWithoutPredictions: false
  });
  
  // Format dates for completed matches
  completedMatches.forEach(match => {
    if (match.match_date && match.match_date.includes('T')) {
      const date = new Date(match.match_date);
      if (Number.isNaN(date.getTime())) {
        logger.error('Error formatting date for stats', {
          matchDate: match.match_date,
          error: 'Invalid date'
        });
      } else {
        match.match_date = date.toLocaleDateString('en-AU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      }
    }
  });
  
  // Filter out admin users from leaderboard
  const filteredPredictorStats = predictorStatsService.filterAndSortPredictorStats(predictorStats, predictors);

  // Determine current round (first incomplete round) from the rounds data
  let currentRound = null;
  if (rounds && rounds.length > 0) {
    currentRound = roundViewService.getCurrentRound(rounds);
    
    logger.debug('Current round detection:', {
      totalRounds: rounds.length,
      roundsCompletion: rounds.map(r => ({ round: r.round_number, completed: r.isCompleted })),
      detectedCurrentRound: currentRound
    });
  }

  // Calculate round-by-round statistics if a round is selected
  let roundPredictorStats = [];
  let cumulativePredictorStats = [];
  let completedMatchesForRound = [];
  const roundToShow = selectedRound || defaultRound;
  
  if (roundToShow) {
    logger.debug(`Calculating round statistics for round ${roundToShow}`);
    
    // Get completed matches for the specific round
    completedMatchesForRound = await matchService.getCompletedMatchesForRoundSelection(selectedYear, roundToShow);
    
    const roundSourceRounds = getSourceRoundsForSelection(rounds, roundToShow);
    const cumulativeSourceRounds = getSourceRoundsThroughSelection(rounds, roundToShow);

    roundPredictorStats = predictorStatsService.filterAndSortPredictorStats(
      predictorStatsService.buildPredictorStats(predictors, predictorPredictions, {
        sourceRounds: roundSourceRounds
      }),
      predictors
    );
    cumulativePredictorStats = predictorStatsService.filterAndSortPredictorStats(
      predictorStatsService.buildPredictorStats(predictors, predictorPredictions, {
        sourceRounds: cumulativeSourceRounds
      }),
      predictors
    );
    
    logger.info(`Round ${roundToShow} statistics calculated for ${roundPredictorStats.length} predictors`);
  }

  const processingTime = Date.now() - startTime;
  logger.info(`Stats page generated in ${processingTime}ms`, {
    userId: req.session.user.id,
    year: selectedYear,
    round: roundToShow,
    predictorCount: predictorStats.length,
    matchCount: completedMatches.length,
    roundMatchCount: completedMatchesForRound.length
  });

  // Create all predictors list (including excluded ones) for admin controls
  // Include ALL predictors except the Admin user itself
  const allPredictorStats = allPredictors
    .filter(predictor => !predictor.is_admin)
    .map(predictor => ({
      id: predictor.predictor_id,
      name: predictor.name,
      display_name: predictor.display_name,
      stats_excluded: predictor.stats_excluded
    }));

  res.render('stats', {
    years,
    selectedYear,
    predictorStats: filteredPredictorStats,
    allPredictors: allPredictorStats,
    completedMatches,
    userPredictions,
    currentUser: req.session.user,
    // csrfToken is automatically available via res.locals from csrf middleware
    isAdmin: req.session.isAdmin,
    // Round-by-round data
    rounds,
    selectedRound: roundToShow,
    currentRound: currentRound,
    defaultRound,
    roundPredictorStats,
    cumulativePredictorStats,
    completedMatchesForRound
  });
}));

// AJAX route for round statistics
router.get('/stats/round/:round', catchAsync(async (req, res) => {
  const startTime = Date.now();
  
  const { selectedYear } = await roundService.resolveYear(req.query.year, {
    minYear: 2022
  });
  const roundNumber = roundService.normalizeRoundForDisplay(req.params.round, selectedYear);
  
  logger.info(`AJAX round stats requested by user ${req.session.user.id} for year ${selectedYear}, round ${roundNumber}`);
  
  // Get all predictors, but include admin status and filter out excluded ones
  const allPredictors = await predictorService.getPredictorsWithAdminStatus();
  const predictors = allPredictors.filter(predictor => !predictor.stats_excluded);
  await predictionService.ensureMissedPredictionsForPredictorsAndYear(
    getMissedDefaultPredictorIds(allPredictors),
    selectedYear
  );
  const rounds = roundService.combineRoundsForDisplay(
    await roundService.getRoundsForYear(selectedYear),
    selectedYear
  );
  
  // Get completed matches for the specific round
  const completedMatchesForRound = await matchService.getCompletedMatchesForRoundSelection(selectedYear, roundNumber);
  
  const predictorPredictions = new Map(await Promise.all(
    predictors.map(async predictor => ([
      predictor.predictor_id,
      await predictionService.getPredictionsWithResultsForYear(predictor.predictor_id, selectedYear)
    ]))
  ));
  const roundSourceRounds = getSourceRoundsForSelection(rounds, roundNumber);
  const cumulativeSourceRounds = getSourceRoundsThroughSelection(rounds, roundNumber);
  const filteredRoundPredictorStats = predictorStatsService.filterAndSortPredictorStats(
    predictorStatsService.buildPredictorStats(predictors, predictorPredictions, {
      sourceRounds: roundSourceRounds
    }),
    predictors
  );
  const cumulativePredictorStats = predictorStatsService.filterAndSortPredictorStats(
    predictorStatsService.buildPredictorStats(predictors, predictorPredictions, {
      sourceRounds: cumulativeSourceRounds
    }),
    predictors
  );
  
  const processingTime = Date.now() - startTime;
  logger.info(`Round ${roundNumber} stats generated in ${processingTime}ms`, {
    userId: req.session.user.id,
    year: selectedYear,
    round: roundNumber,
    predictorCount: filteredRoundPredictorStats.length,
    matchCount: completedMatchesForRound.length
  });
  
  res.json({
    success: true,
    roundPredictorStats: filteredRoundPredictorStats,
    cumulativePredictorStats,
    completedMatchesForRound,
    selectedRound: roundNumber,
    selectedYear: selectedYear,
    currentUser: req.session.user
  });
}));

module.exports = router;
