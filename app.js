const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const path = require('path');
const methodOverride = require('method-override');
const helmet = require('helmet');
require('dotenv').config();

// Validate required environment variables
if (!process.env.SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET environment variable is required');
  process.exit(1);
}

// Import utilities
const { errorMiddleware, catchAsync } = require('./utils/error-handler');
const { logger, requestLogger } = require('./utils/logger');
const { getQuery } = require('./models/db');
const csrfProtection = require('./middleware/csrf');

// Import services
const roundService = require('./services/round-service');
const matchService = require('./services/match-service');

// Import routes
const authRoutes = require('./routes/auth');
const predictionsRoutes = require('./routes/predictions');
const matchesRoutes = require('./routes/matches');
const adminRoutes = require('./routes/admin');
const eloRoutes = require('./routes/elo');

// Initialize express app
const app = express();
const port = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://api.squiggle.com.au", "https://cdn.jsdelivr.net"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-site" }
}));

// Configure view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve the scoring service as a client-side script
app.get('/js/scoring-service.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'services', 'scoring-service.js'));
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Trust proxy for secure cookies behind reverse proxy
app.set('trust proxy', 1);

// Session configuration
app.use(session({
  store: new SqliteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'data/database')  // Use absolute path
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Make user data available to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

// Add request logging middleware (before routes)
app.use(requestLogger);

// CSRF Protection
app.use(csrfProtection);

// Favicon route to prevent 404 errors
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Routes
app.use('/', authRoutes);
app.use('/predictions', predictionsRoutes);
app.use('/matches', matchesRoutes);
app.use('/admin', adminRoutes);
app.use('/api/elo', eloRoutes);

// Global API endpoint for excluded predictors (accessible to all users)
app.get('/api/excluded-predictors', catchAsync(async (req, res) => {
  // Import admin routes to access the excluded predictors
  const adminRoutes = require('./routes/admin');
  const excludedPredictors = await adminRoutes.getExcludedPredictors();
  res.json({ excludedPredictors });
}));

// Home route - updated to show featured predictions
app.get('/', catchAsync(async (req, res) => {
  // Get current year
  const currentYear = new Date().getFullYear();
  
  // Get homepage available predictors and default featured predictor
  const featuredPredictionsService = require('./services/featured-predictions');
  const homepageAvailablePredictors = await featuredPredictionsService.getHomepageAvailablePredictors();
  const defaultFeaturedPredictor = await featuredPredictionsService.getDefaultFeaturedPredictor();
  
  // Get rounds for current year ordered by the round ordering logic
  const allRounds = await roundService.getRoundsForYear(currentYear);
  
  // Current date for comparison
  const currentDate = new Date();
  
  // Get all matches for the year
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
  
  const allMatches = await getQuery(allMatchesQuery, [currentYear]);
  
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
  const roundsWithStatus = allRounds.map(roundObj => {
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
  
  // First priority: Find the round with the next upcoming match
  let targetRound = null;
  let nextUpcomingMatch = null;
  
  // Find the next upcoming match across all rounds
  for (const match of allMatches) {
    if (!match.match_date) continue;
    
    try {
      const matchDate = new Date(match.match_date);
      if (!isNaN(matchDate.getTime()) && 
          matchDate > currentDate && 
          (match.hscore === null || match.ascore === null)) {
        // This is an upcoming match
        if (!nextUpcomingMatch || new Date(match.match_date) < new Date(nextUpcomingMatch.match_date)) {
          nextUpcomingMatch = match;
        }
      }
    } catch (err) {
      logger.error('Error parsing match date', { 
        matchDate: match.match_date,
        error: err.message 
      });
    }
  }
  
  // If we found an upcoming match, use its round
  if (nextUpcomingMatch) {
    targetRound = nextUpcomingMatch.round_number;
    logger.info(`Found next upcoming match in round ${targetRound}`, { 
      match: `${nextUpcomingMatch.home_team} vs ${nextUpcomingMatch.away_team}`,
      date: nextUpcomingMatch.match_date
    });
  } else {
    // Second priority: Find the most recent round with completed matches
    let mostRecentCompletedRound = null;
    let mostRecentMatch = null;
    
    for (const match of allMatches) {
      if (!match.match_date || match.hscore === null || match.ascore === null) continue;
      
      try {
        const matchDate = new Date(match.match_date);
        if (!isNaN(matchDate.getTime()) && 
            (!mostRecentMatch || matchDate > new Date(mostRecentMatch.match_date))) {
          mostRecentMatch = match;
          mostRecentCompletedRound = match.round_number;
        }
      } catch (err) {
        logger.error('Error parsing match date', { 
          matchDate: match.match_date,
          error: err.message 
        });
      }
    }
    
    if (mostRecentCompletedRound) {
      targetRound = mostRecentCompletedRound;
      logger.info(`No upcoming matches found, using most recent completed round: ${targetRound}`);
    } else {
      // Third priority: Just use the first round
      if (allRounds.length > 0) {
        targetRound = allRounds[0].round_number;
        logger.info(`No completed matches found, using first round: ${targetRound}`);
      }
    }
  }
  
  // If we still don't have a target round, use "OR" (Opening Round) as a fallback
  if (!targetRound && allRounds.length > 0) {
    targetRound = "OR";
    logger.warn(`Falling back to Opening Round as no suitable round found`);
  }
  
  // Get predictions for the default featured predictor for the target round
  const { predictor, matches, predictions } = 
    await featuredPredictionsService.getPredictionsForRound(defaultFeaturedPredictor?.predictor_id, targetRound, currentYear);
  
  // Calculate overall performance metrics for default featured predictor
  let featuredPredictorStats = null;
  if (defaultFeaturedPredictor) {
    const predictionService = require('./services/prediction-service');
    const scoringService = require('./services/scoring-service');
    
    // Get all predictions with results for this predictor for the current year
    const predictionResults = await predictionService.getPredictionsWithResultsForYear(defaultFeaturedPredictor.predictor_id, currentYear);
    
    if (predictionResults.length > 0) {
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
      const avgBrierScore = (totalBrierScore / totalPredictions).toFixed(4);
      const bitsScoreSum = totalBitsScore.toFixed(2);
      const tipAccuracy = ((tipPoints / totalPredictions) * 100).toFixed(1);
      const marginMAE = marginPredictionCount > 0 ? (marginErrorSum / marginPredictionCount).toFixed(2) : null;
      
      featuredPredictorStats = {
        tipPoints,
        totalPredictions,
        tipAccuracy,
        brierScore: avgBrierScore,
        bitsScore: bitsScoreSum,
        marginMAE: marginMAE,
        marginPredictionCount: marginPredictionCount
      };
    }
  }
  
  res.render('home', { 
    user: req.session.user,
    isAdmin: req.session.isAdmin,
    featuredPredictor: defaultFeaturedPredictor,
    featuredPredictorStats: featuredPredictorStats,
    homepageAvailablePredictors: homepageAvailablePredictors,
    rounds: roundsWithStatus,
    selectedRound: targetRound,
    currentRound: currentRound,
    matches,
    predictions,
    currentYear
  });
}));

// API endpoint for predictor performance stats
app.get('/api/predictor-stats', catchAsync(async (req, res) => {
  const selectedYear = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
  const predictorId = req.query.predictorId;
  
  if (!predictorId) {
    return res.json({ success: false, message: 'Predictor ID is required' });
  }
  
  // Get predictor details
  const predictorService = require('./services/predictor-service');
  const predictor = await predictorService.getPredictorById(predictorId);
  
  if (!predictor) {
    return res.json({ success: false, message: 'Predictor not found' });
  }
  
  // Calculate performance metrics for the selected year
  const predictionService = require('./services/prediction-service');
  const scoringService = require('./services/scoring-service');
  
  // Get all predictions with results for this predictor for the selected year
  const predictionResults = await predictionService.getPredictionsWithResultsForYear(predictor.predictor_id, selectedYear);
  
  if (predictionResults.length === 0) {
    return res.json({ success: false, message: 'No prediction data available for this year' });
  }
  
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
  const avgBrierScore = (totalBrierScore / totalPredictions).toFixed(4);
  const bitsScoreSum = totalBitsScore.toFixed(2);
  const tipAccuracy = ((tipPoints / totalPredictions) * 100).toFixed(1);
  const marginMAE = marginPredictionCount > 0 ? (marginErrorSum / marginPredictionCount).toFixed(2) : null;
  
  const stats = {
    tipPoints,
    totalPredictions,
    tipAccuracy,
    brierScore: avgBrierScore,
    bitsScore: bitsScoreSum,
    marginMAE: marginMAE,
    marginPredictionCount: marginPredictionCount
  };
  
  res.json({ success: true, stats: stats });
}));

// Featured predictions route for AJAX updates
app.get('/featured-predictions/:round', catchAsync(async (req, res) => {
  const round = req.params.round;
  const year = req.query.year || new Date().getFullYear();
  const predictorId = req.query.predictorId;
  
  const featuredPredictionsService = require('./services/featured-predictions');
  
  // If no predictor ID is provided, use the default featured predictor
  let targetPredictorId = predictorId;
  if (!targetPredictorId) {
    const defaultFeaturedPredictor = await featuredPredictionsService.getDefaultFeaturedPredictor();
    targetPredictorId = defaultFeaturedPredictor?.predictor_id;
  }
  
  const { predictor, matches, predictions } = 
    await featuredPredictionsService.getPredictionsForRound(targetPredictorId, round, year);
  
  res.json({
    predictor,
    matches,
    predictions
  });
}));

// Add global error handler (after routes)
app.use(errorMiddleware);

// Start server
app.listen(port, '0.0.0.0', () => {
  logger.info(`Server running on http://0.0.0.0:${port}`);
});