const express = require('express');
const router = express.Router();
const { getQuery } = require('../models/db');
const featuredPredictionsService = require('../services/featured-predictions');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');
const predictorStatsService = require('../services/predictor-stats-service');
const roundService = require('../services/round-service');
const roundViewService = require('../services/round-view-service');
const { catchAsync } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

async function getAllMatchesForYear(year) {
  return getQuery(
    `
    SELECT m.*,
       t1.name as home_team,
       t2.name as away_team,
       m.round_number
    FROM matches m
    JOIN teams t1 ON m.home_team_id = t1.team_id
    JOIN teams t2 ON m.away_team_id = t2.team_id
    WHERE m.year = ?
    ORDER BY m.match_date
    `,
    [year]
  );
}

async function resolveFeaturedYear(requestedYearQuery, defaultFeaturedPredictor) {
  const predictionYearsRaw = await featuredPredictionsService.getPredictionYearsForPredictor(
    defaultFeaturedPredictor?.predictor_id
  );
  const years = predictionYearsRaw
    .map((row) => ({ year: parseInt(row.year, 10) }))
    .filter((row) => !Number.isNaN(row.year));
  const availablePredictionYears = years.map((row) => row.year);
  const requestedYear = parseInt(requestedYearQuery, 10);
  const hasValidRequestedYear = !Number.isNaN(requestedYear)
    && availablePredictionYears.includes(requestedYear);

  if (hasValidRequestedYear) {
    return { currentYear: requestedYear, years };
  }

  if (availablePredictionYears.length > 0) {
    return { currentYear: availablePredictionYears[0], years };
  }

  const { selectedYear } = await roundService.resolveYear(requestedYearQuery);
  return { currentYear: selectedYear, years };
}

async function buildFeaturedPredictorStats(defaultFeaturedPredictor, currentYear) {
  if (!defaultFeaturedPredictor) {
    return null;
  }

  const predictionResults = await predictionService.getPredictionsWithResultsForYear(
    defaultFeaturedPredictor.predictor_id,
    currentYear
  );

  if (predictionResults.length === 0) {
    return null;
  }

  const { id, name, display_name, ...stats } = predictorStatsService.calculatePredictorStats(defaultFeaturedPredictor, predictionResults, {
    bitsScoreDigits: 2
  });
  return stats;
}

router.get('/api/excluded-predictors', catchAsync(async (req, res) => {
  const adminRoutes = require('./admin');
  const excludedPredictors = await adminRoutes.getExcludedPredictors();
  res.json({ excludedPredictors });
}));

router.get('/api/predictor-stats', catchAsync(async (req, res) => {
  const { selectedYear } = await roundService.resolveYear(req.query.year);
  const predictorId = req.query.predictorId;

  if (!predictorId) {
    return res.json({ success: false, message: 'Predictor ID is required' });
  }

  const predictor = await predictorService.getPredictorById(predictorId);
  if (!predictor) {
    return res.json({ success: false, message: 'Predictor not found' });
  }

  const predictionResults = await predictionService.getPredictionsWithResultsForYear(
    predictor.predictor_id,
    selectedYear
  );

  if (predictionResults.length === 0) {
    return res.json({ success: false, message: 'No prediction data available for this year' });
  }

  const { id, name, display_name, ...stats } = predictorStatsService.calculatePredictorStats(predictor, predictionResults, {
    bitsScoreDigits: 2
  });

  res.json({ success: true, stats });
}));

router.get('/', catchAsync(async (req, res) => {
  const defaultFeaturedPredictor = await featuredPredictionsService.getDefaultFeaturedPredictor();
  const { currentYear, years } = await resolveFeaturedYear(req.query.year, defaultFeaturedPredictor);
  const allRounds = await roundService.getRoundsForYear(currentYear);
  const allMatches = await getAllMatchesForYear(currentYear);
  const rounds = roundViewService.buildDisplayRounds(allRounds, allMatches, currentYear);
  const currentRound = roundViewService.getCurrentRound(rounds);
  let targetRound = roundViewService.selectDefaultRound(allMatches, allRounds, currentYear);

  if (!targetRound && allRounds.length > 0) {
    targetRound = 'OR';
    logger.warn('Falling back to Opening Round as no suitable round found');
  }

  const { predictor, matches, predictions } =
    await featuredPredictionsService.getPredictionsForRound(
      defaultFeaturedPredictor?.predictor_id,
      targetRound,
      currentYear
    );
  const featuredPredictorStats = await buildFeaturedPredictorStats(defaultFeaturedPredictor, currentYear);

  res.render('home', {
    user: req.session.user,
    isAdmin: req.session.isAdmin,
    featuredPredictor: defaultFeaturedPredictor,
    featuredPredictorStats,
    years,
    selectedYear: currentYear,
    rounds,
    selectedRound: targetRound,
    currentRound,
    matches,
    predictions,
    currentYear
  });
}));

module.exports = router;
module.exports.getAllMatchesForYear = getAllMatchesForYear;
module.exports.resolveFeaturedYear = resolveFeaturedYear;
