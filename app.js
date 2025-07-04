const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const path = require('path');
const methodOverride = require('method-override');
require('dotenv').config();

// Import utilities
const { errorMiddleware, catchAsync } = require('./utils/error-handler');
const { logger, requestLogger } = require('./utils/logger');
const { getQuery } = require('./models/db');

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
const port = 3001;

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

// Session configuration
app.use(session({
  store: new SqliteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'data')  // Use absolute path
  }),
  secret: process.env.SESSION_SECRET || 'afl-predictions-secret-key',
  resave: true,                       // Changed to true
  saveUninitialized: true,            // Changed to true
  cookie: { 
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: false                     // Set to false for HTTP
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

// Routes
app.use('/', authRoutes);
app.use('/predictions', predictionsRoutes);
app.use('/matches', matchesRoutes);
app.use('/admin', adminRoutes);
app.use('/api/elo', eloRoutes);

// Home route - updated to show featured predictions
app.get('/', catchAsync(async (req, res) => {
  // Get current year
  const currentYear = new Date().getFullYear();
  
  // Get featured predictor
  const featuredPredictionsService = require('./services/featured-predictions');
  const featuredPredictor = await featuredPredictionsService.getFeaturedPredictor();
  
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
  
  // Get featured predictions for the target round
  const { predictor, matches, predictions } = 
    await featuredPredictionsService.getFeaturedPredictionsForRound(targetRound, currentYear);
  
  res.render('home', { 
    user: req.session.user,
    isAdmin: req.session.isAdmin,
    featuredPredictor: predictor,
    rounds: roundsWithStatus,
    selectedRound: targetRound,
    currentRound: currentRound,
    matches,
    predictions,
    currentYear
  });
}));

// Featured predictions route for AJAX updates
app.get('/featured-predictions/:round', catchAsync(async (req, res) => {
  const round = req.params.round;
  const year = req.query.year || new Date().getFullYear();
  
  const featuredPredictionsService = require('./services/featured-predictions');
  const { predictor, matches, predictions } = 
    await featuredPredictionsService.getFeaturedPredictionsForRound(round, year);
  
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