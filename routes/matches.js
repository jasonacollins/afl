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

// Require authentication for all matches routes
router.use(isAuthenticated);

// This function ensures all predictors have predictions for all completed matches
const ensureDefaultPredictions = catchAsync(async (selectedYear) => {
  logger.info(`Starting default predictions check for year ${selectedYear}`);
  
  // Get all predictors with their year_joined
  const predictors = await getQuery('SELECT predictor_id, year_joined FROM predictors');
  
  // Get all completed matches for the selected year with match dates
  const completedMatches = await getQuery(`
    SELECT match_id, match_date 
    FROM matches 
    WHERE hscore IS NOT NULL 
    AND ascore IS NOT NULL
    AND year = ?
  `, [selectedYear]);
  
  // Current date for comparison
  const currentDate = new Date();
  let defaultPredictionsCreated = 0;
  
  // For each predictor, check if they have predictions for all completed matches
  for (const predictor of predictors) {
    // Skip if predictor joined after the selected year
    if (predictor.year_joined && predictor.year_joined > selectedYear) {
      logger.debug(`Skipping predictor ${predictor.predictor_id}: joined in ${predictor.year_joined}, selected year is ${selectedYear}`);
      continue;
    }
    
    for (const match of completedMatches) {
      // Only create default predictions for matches that have already occurred
      let matchInPast = true;
      
      if (match.match_date) {
        try {
          const matchDate = new Date(match.match_date);
          // Check if matchDate is valid and in the past
          if (!isNaN(matchDate.getTime()) && matchDate > currentDate) {
            matchInPast = false;
          }
        } catch (err) {
          logger.error('Error parsing match date', { 
            matchDate: match.match_date,
            error: err.message 
          });
        }
      }
      
      // Skip if the match is in the future
      if (!matchInPast) {
        continue;
      }
      
      // Check if the predictor has a prediction for this match
      const existingPrediction = await getOne(`
        SELECT * FROM predictions 
        WHERE predictor_id = ? AND match_id = ?
      `, [predictor.predictor_id, match.match_id]);
      
      // If no prediction exists, create a default one (50% with home team tip)
      if (!existingPrediction) {
        await runQuery(`
          INSERT INTO predictions 
          (match_id, predictor_id, home_win_probability, tipped_team) 
          VALUES (?, ?, 50, 'home')
        `, [match.match_id, predictor.predictor_id]);
        
        defaultPredictionsCreated++;
        logger.debug(`Created default prediction for predictor ${predictor.predictor_id}, match ${match.match_id}`);
      }
    }
  }
  
  logger.info(`Default predictions check completed - created ${defaultPredictionsCreated} predictions`);
});

// Get all matches
router.get('/round/:round', catchAsync(async (req, res) => {
  const round = req.params.round;
  const year = req.query.year || new Date().getFullYear();
  
  logger.debug(`Fetching matches for round ${round}, year ${year}`);
  
  // Get matches for the specific round and year
  const matches = await matchService.getMatchesByRoundAndYear(round, year);
  
  res.json(matches);
}));

// Get all rounds
router.get('/', catchAsync(async (req, res) => {
  // Get the selected year or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
  
  // Get all available years
  let yearQuery = 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
  if (!req.session.isAdmin) {
    yearQuery = 'SELECT DISTINCT year FROM matches WHERE year >= 2022 ORDER BY year DESC';
  }
  const years = await getQuery(yearQuery);
  
  // Get all rounds for the selected year
  const rounds = await roundService.getRoundsForYear(selectedYear);
  
  res.json(rounds);
}));

// Get stats page
router.get('/stats', catchAsync(async (req, res) => {
  const startTime = Date.now();
  
  // Get the selected year or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
  
  // Get round parameter for round-by-round stats
  const selectedRound = req.query.round || null;
  
  logger.info(`Stats page accessed by user ${req.session.user.id} for year ${selectedYear}${selectedRound ? `, round ${selectedRound}` : ''}`);
  
  // Get all available years
  const yearQuery = 'SELECT DISTINCT year FROM matches WHERE year >= 2022 ORDER BY year DESC';
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
  
  // Add completion status to rounds
  const rounds = allRounds.map(roundObj => {
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
  
  // Get the most recent round with results for default selection
  const mostRecentRound = await matchService.getMostRecentRoundWithResults();
  const defaultRound = mostRecentRound && mostRecentRound.year === selectedYear ? mostRecentRound.round : null;    
  
  // Ensure all predictors have predictions for completed matches
  await ensureDefaultPredictions(selectedYear);
  
  // Get all predictors, but include admin status and filter out excluded ones
  const allPredictors = await predictorService.getPredictorsWithAdminStatus();
  const predictors = allPredictors.filter(predictor => !predictor.stats_excluded);
  
  // Get matches with results for the selected year
  const completedMatches = await matchService.getCompletedMatchesForYear(selectedYear);
  
  // Get current user's predictions for completed matches in the selected year
  const userPredictions = await predictionService.getPredictionsForUser(req.session.user.id);
  
  // Calculate accuracy for each predictor with additional metrics
  const predictorStats = [];
  
  for (const predictor of predictors) {
    // Get all predictions for this predictor with results for the selected year
    const predictionResults = await predictionService.getPredictionsWithResultsForYear(predictor.predictor_id, selectedYear);
    
    let tipPoints = 0;
    let totalBrierScore = 0;
    let totalBitsScore = 0;
    let totalPredictions = predictionResults.length;
    let marginErrorSum = 0;
    let marginPredictionCount = 0;
    
    // Calculate metrics for each prediction
    predictionResults.forEach(pred => {
      const homeWon = pred.hscore > pred.ascore;
      const awayWon = pred.hscore < pred.ascore;
      const tie = pred.hscore === pred.ascore;
      
      // Determine outcome (1 if home team won, 0.5 if tie, 0 if away team won)
      const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
      
      // Use scoring service
      const brierScore = scoringService.calculateBrierScore(pred.home_win_probability, actualOutcome);
      totalBrierScore += brierScore;
      
      const bitsScore = scoringService.calculateBitsScore(pred.home_win_probability, actualOutcome);
      totalBitsScore += bitsScore;
      
      // Get tipped team (default to home if not stored)
      const tippedTeam = pred.tipped_team || 'home';
      
      // Calculate tip points
      const tipPointsForPred = scoringService.calculateTipPoints(pred.home_win_probability, pred.hscore, pred.ascore, tippedTeam);
      tipPoints += tipPointsForPred;
      
      // Calculate margin error if predicted_margin exists
      if (pred.predicted_margin !== null && pred.predicted_margin !== undefined) {
        const actualMargin = pred.hscore - pred.ascore;
        const marginError = Math.abs(actualMargin - pred.predicted_margin);
        marginErrorSum += marginError;
        marginPredictionCount++;
      }
    });
    
    // Calculate averages and percentages
    const avgBrierScore = totalPredictions > 0 ? (totalBrierScore / totalPredictions).toFixed(4) : 0;
    const bitsScoreSum = totalPredictions > 0 ? totalBitsScore.toFixed(4) : 0;
    const tipAccuracy = totalPredictions > 0 ? ((tipPoints / totalPredictions) * 100).toFixed(1) : 0;
    const marginMAE = marginPredictionCount > 0 ? (marginErrorSum / marginPredictionCount).toFixed(2) : null;
    
    predictorStats.push({
      id: predictor.predictor_id,
      name: predictor.name,
      display_name: predictor.display_name,
      tipPoints,
      totalPredictions,
      tipAccuracy,
      brierScore: avgBrierScore,
      bitsScore: bitsScoreSum,
      marginMAE: marginMAE,
      marginPredictionCount: marginPredictionCount
    });
  }
  
  // Sort predictors by tip accuracy (highest first)
  predictorStats.sort((a, b) => parseFloat(b.tipAccuracy) - parseFloat(a.tipAccuracy));
  
  // Format dates for completed matches
  completedMatches.forEach(match => {
    if (match.match_date && match.match_date.includes('T')) {
      try {
        const date = new Date(match.match_date);
        match.match_date = date.toLocaleDateString('en-AU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      } catch (error) {
        logger.error('Error formatting date for stats', { 
          matchDate: match.match_date, 
          error: error.message 
        });
      }
    }
  });
  
  // Filter out admin users from leaderboard
  const filteredPredictorStats = predictorStats.filter(stat => {
    const predictor = predictors.find(p => p.predictor_id === stat.id);
    return predictor && !predictor.is_admin;
  });

  // Sort by Brier score (lower is better)
  filteredPredictorStats.sort((a, b) => parseFloat(a.brierScore) - parseFloat(b.brierScore));

  // Determine current round (first incomplete round) from the rounds data
  let currentRound = null;
  if (rounds && rounds.length > 0) {
    // Find first round that's not completed
    const currentRoundObj = rounds.find(round => !round.isCompleted);
    currentRound = currentRoundObj ? currentRoundObj.round_number : null;
    
    logger.debug('Current round detection:', {
      totalRounds: rounds.length,
      roundsCompletion: rounds.map(r => ({ round: r.round_number, completed: r.isCompleted })),
      detectedCurrentRound: currentRound
    });
  }

  // Calculate round-by-round statistics if a round is selected
  let roundPredictorStats = [];
  let completedMatchesForRound = [];
  const roundToShow = selectedRound || defaultRound;
  
  if (roundToShow) {
    logger.debug(`Calculating round statistics for round ${roundToShow}`);
    
    // Get completed matches for the specific round
    completedMatchesForRound = await matchService.getCompletedMatchesForRound(selectedYear, roundToShow);
    
    // Calculate round-specific statistics for each predictor
    for (const predictor of predictors) {
      // Get predictions for this predictor for the specific round
      const roundPredictionResults = await predictionService.getPredictionsWithResultsForRound(predictor.predictor_id, selectedYear, roundToShow);
      
      let tipPoints = 0;
      let totalBrierScore = 0;
      let totalBitsScore = 0;
      let totalPredictions = roundPredictionResults.length;
      let marginErrorSum = 0;
      let marginPredictionCount = 0;
      
      // Calculate metrics for each prediction in this round
      roundPredictionResults.forEach(pred => {
        const homeWon = pred.hscore > pred.ascore;
        const awayWon = pred.hscore < pred.ascore;
        const tie = pred.hscore === pred.ascore;
        
        // Determine outcome (1 if home team won, 0.5 if tie, 0 if away team won)
        const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
        
        // Use scoring service
        const brierScore = scoringService.calculateBrierScore(pred.home_win_probability, actualOutcome);
        totalBrierScore += brierScore;
        
        const bitsScore = scoringService.calculateBitsScore(pred.home_win_probability, actualOutcome);
        totalBitsScore += bitsScore;
        
        // Get tipped team (default to home if not stored)
        const tippedTeam = pred.tipped_team || 'home';
        
        // Calculate tip points
        const tipPointsForPred = scoringService.calculateTipPoints(pred.home_win_probability, pred.hscore, pred.ascore, tippedTeam);
        tipPoints += tipPointsForPred;
        
        // Calculate margin error if predicted_margin exists
        if (pred.predicted_margin !== null && pred.predicted_margin !== undefined) {
          const actualMargin = pred.hscore - pred.ascore;
          const marginError = Math.abs(actualMargin - pred.predicted_margin);
          marginErrorSum += marginError;
          marginPredictionCount++;
        }
      });
      
      // Calculate averages and percentages for round
      const avgBrierScore = totalPredictions > 0 ? (totalBrierScore / totalPredictions).toFixed(4) : 0;
      const bitsScoreSum = totalPredictions > 0 ? totalBitsScore.toFixed(4) : 0;
      const tipAccuracy = totalPredictions > 0 ? ((tipPoints / totalPredictions) * 100).toFixed(1) : 0;
      const marginMAE = marginPredictionCount > 0 ? (marginErrorSum / marginPredictionCount).toFixed(2) : null;
      
      roundPredictorStats.push({
        id: predictor.predictor_id,
        name: predictor.name,
        display_name: predictor.display_name,
        tipPoints,
        totalPredictions,
        tipAccuracy,
        brierScore: avgBrierScore,
        bitsScore: bitsScoreSum,
        marginMAE: marginMAE,
        marginPredictionCount: marginPredictionCount
      });
    }
    
    // Filter out admin users from round leaderboard and sort by Brier score
    roundPredictorStats = roundPredictorStats.filter(stat => {
      const predictor = predictors.find(p => p.predictor_id === stat.id);
      return predictor && !predictor.is_admin;
    });
    roundPredictorStats.sort((a, b) => parseFloat(a.brierScore) - parseFloat(b.brierScore));
    
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
    completedMatchesForRound
  });
}));

// AJAX route for round statistics
router.get('/stats/round/:round', catchAsync(async (req, res) => {
  const startTime = Date.now();
  const roundNumber = req.params.round;
  
  // Get the selected year or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
  
  logger.info(`AJAX round stats requested by user ${req.session.user.id} for year ${selectedYear}, round ${roundNumber}`);
  
  // Get all predictors, but include admin status and filter out excluded ones
  const allPredictors = await predictorService.getPredictorsWithAdminStatus();
  const predictors = allPredictors.filter(predictor => !predictor.stats_excluded);
  
  // Get completed matches for the specific round
  const completedMatchesForRound = await matchService.getCompletedMatchesForRound(selectedYear, roundNumber);
  
  // Calculate round-specific statistics for each predictor
  const roundPredictorStats = [];
  
  for (const predictor of predictors) {
    // Get predictions for this predictor for the specific round
    const roundPredictionResults = await predictionService.getPredictionsWithResultsForRound(predictor.predictor_id, selectedYear, roundNumber);
    
    let tipPoints = 0;
    let totalBrierScore = 0;
    let totalBitsScore = 0;
    let totalPredictions = roundPredictionResults.length;
    let marginErrorSum = 0;
    let marginPredictionCount = 0;
    
    // Calculate metrics for each prediction in this round
    roundPredictionResults.forEach(pred => {
      const homeWon = pred.hscore > pred.ascore;
      const awayWon = pred.hscore < pred.ascore;
      const tie = pred.hscore === pred.ascore;
      
      // Determine outcome (1 if home team won, 0.5 if tie, 0 if away team won)
      const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
      
      // Use scoring service
      const brierScore = scoringService.calculateBrierScore(pred.home_win_probability, actualOutcome);
      totalBrierScore += brierScore;
      
      const bitsScore = scoringService.calculateBitsScore(pred.home_win_probability, actualOutcome);
      totalBitsScore += bitsScore;
      
      // Get tipped team (default to home if not stored)
      const tippedTeam = pred.tipped_team || 'home';
      
      // Calculate tip points
      const tipPointsForPred = scoringService.calculateTipPoints(pred.home_win_probability, pred.hscore, pred.ascore, tippedTeam);
      tipPoints += tipPointsForPred;
      
      // Calculate margin error if predicted_margin exists
      if (pred.predicted_margin !== null && pred.predicted_margin !== undefined) {
        const actualMargin = pred.hscore - pred.ascore;
        const marginError = Math.abs(actualMargin - pred.predicted_margin);
        marginErrorSum += marginError;
        marginPredictionCount++;
      }
    });
    
    // Calculate averages and percentages for round
    const avgBrierScore = totalPredictions > 0 ? (totalBrierScore / totalPredictions).toFixed(4) : 0;
    const bitsScoreSum = totalPredictions > 0 ? totalBitsScore.toFixed(4) : 0;
    const tipAccuracy = totalPredictions > 0 ? ((tipPoints / totalPredictions) * 100).toFixed(1) : 0;
    const marginMAE = marginPredictionCount > 0 ? (marginErrorSum / marginPredictionCount).toFixed(2) : null;
    
    roundPredictorStats.push({
      id: predictor.predictor_id,
      name: predictor.name,
      display_name: predictor.display_name,
      tipPoints,
      totalPredictions,
      tipAccuracy,
      brierScore: avgBrierScore,
      bitsScore: bitsScoreSum,
      marginMAE: marginMAE,
      marginPredictionCount: marginPredictionCount
    });
  }
  
  // Filter out admin users from round leaderboard and sort by Brier score
  const filteredRoundPredictorStats = roundPredictorStats.filter(stat => {
    const predictor = predictors.find(p => p.predictor_id === stat.id);
    return predictor && !predictor.is_admin;
  });
  filteredRoundPredictorStats.sort((a, b) => parseFloat(a.brierScore) - parseFloat(b.brierScore));
  
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
    completedMatchesForRound,
    selectedRound: roundNumber,
    selectedYear: selectedYear,
    currentUser: req.session.user
  });
}));

module.exports = router;