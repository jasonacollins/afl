const express = require('express');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated, isAdmin } = require('./auth');
const scoringService = require('../services/scoring-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');
const passwordService = require('../services/password-service');
const { AppError, catchAsync, createNotFoundError, createValidationError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const adminScriptRunner = require('../services/admin-script-runner');
const resultUpdateService = require('../services/result-update-service');
const adminDatabaseService = require('../services/admin-database-service');

// Require authentication and admin for all admin routes
router.use(isAuthenticated);
router.use(isAdmin);

async function getPredictorManagementViewModel() {
  const predictors = await predictorService.getAllPredictors();
  const featuredPredictionsService = require('../services/featured-predictions');
  const featuredPredictorId = await featuredPredictionsService.getDefaultFeaturedPredictorId();

  return {
    predictors,
    featuredPredictorId
  };
}

async function getUserPredictionsViewModel(yearQuery) {
  const { selectedYear, years } = await roundService.resolveYear(yearQuery);
  const predictors = await predictorService.getAllPredictors();
  const rawRounds = await roundService.getRoundsForYear(selectedYear);
  const rounds = roundService.combineRoundsForDisplay(rawRounds, selectedYear);

  return {
    predictors,
    rounds,
    years,
    selectedYear,
    selectedUser: null
  };
}

async function getOperationsViewModel(yearQuery) {
  const { selectedYear, years } = await roundService.resolveYear(yearQuery);

  return {
    years,
    selectedYear
  };
}

function buildAdminMetrics(prediction, match) {
  if (!prediction || match.hscore === null || match.ascore === null) {
    return null;
  }

  const probability = prediction.home_win_probability;
  const tippedTeam = prediction.tipped_team || (probability < 50 ? 'away' : 'home');
  const homeWon = match.hscore > match.ascore;
  const tie = match.hscore === match.ascore;
  const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
  const tipPoints = scoringService.calculateTipPoints(probability, match.hscore, match.ascore, tippedTeam);

  let tipClass = 'incorrect';
  if (tipPoints === 1) {
    tipClass = 'correct';
  } else if (tie && probability !== 50) {
    tipClass = 'partial';
  }

  return {
    tipPoints,
    tipClass,
    brierScore: scoringService.calculateBrierScore(probability, actualOutcome).toFixed(4),
    bitsScore: scoringService.calculateBitsScore(probability, actualOutcome).toFixed(4)
  };
}

// API endpoints for managing predictor exclusions
router.get('/api/excluded-predictors', catchAsync(async (req, res) => {
  const excludedPredictors = await getQuery(
    'SELECT predictor_id FROM predictors WHERE stats_excluded = 1'
  );
  
  res.json({ 
    excludedPredictors: excludedPredictors.map(p => p.predictor_id.toString()) 
  });
}));

router.post('/api/excluded-predictors', catchAsync(async (req, res) => {
  const { predictorIds } = req.body;

  logger.info(`Received exclusion update request from admin ${req.session.user.id}:`, predictorIds);

  if (!Array.isArray(predictorIds)) {
    logger.error('Invalid predictorIds - not an array:', predictorIds);
    return res.status(400).json({ error: 'predictorIds must be an array' });
  }

  // First, reset all predictors to not excluded
  await runQuery('UPDATE predictors SET stats_excluded = 0');
  logger.info('Reset all predictors to stats_excluded = 0');

  // Then set the specified predictors as excluded
  if (predictorIds.length > 0) {
    const placeholders = predictorIds.map(() => '?').join(',');
    await runQuery(
      `UPDATE predictors SET stats_excluded = 1 WHERE predictor_id IN (${placeholders})`,
      predictorIds
    );
    logger.info(`Set stats_excluded = 1 for predictors: ${predictorIds.join(', ')}`);
  } else {
    logger.info('No predictors to exclude');
  }

  logger.info(`Admin ${req.session.user.id} successfully updated excluded predictors`);

  res.json({ success: true, excludedPredictors: predictorIds });
}));

// Export function to access excluded predictors
router.getExcludedPredictors = async function() {
  const excludedPredictors = await getQuery(
    'SELECT predictor_id FROM predictors WHERE stats_excluded = 1'
  );
  return excludedPredictors.map(p => p.predictor_id.toString());
};

// Admin dashboard
router.get('/', catchAsync(async (req, res) => {
  logger.info(`Admin dashboard accessed by user ${req.session.user.id}`);

  const viewModel = await getPredictorManagementViewModel();

  res.render('admin', {
    ...viewModel,
    success: req.query.success || null,
    error: req.query.error || null,
    isAdmin: true
  });
}));

router.get('/user-predictions', catchAsync(async (req, res) => {
  logger.info(`Admin user predictions page accessed by user ${req.session.user.id}`);

  const viewModel = await getUserPredictionsViewModel(req.query.year);

  res.render('admin-user-predictions', {
    ...viewModel,
    success: req.query.success || null,
    error: req.query.error || null,
    isAdmin: true
  });
}));

router.get('/operations', catchAsync(async (req, res) => {
  logger.info(`Admin operations page accessed by user ${req.session.user.id}`);

  const viewModel = await getOperationsViewModel(req.query.year);

  res.render('admin-operations', {
    ...viewModel,
    success: req.query.success || null,
    error: req.query.error || null,
    isAdmin: true
  });
}));

// Admin scripts runner page
router.get('/scripts', catchAsync(async (req, res) => {
  logger.info(`Admin scripts page accessed by user ${req.session.user.id}`);

  res.render('admin-scripts', {
    isAdmin: true,
    success: req.query.success || null,
    error: req.query.error || null
  });
}));

// Admin scripts metadata
router.get('/api/script-metadata', catchAsync(async (req, res) => {
  const metadata = await adminScriptRunner.getScriptMetadata();

  res.json({
    success: true,
    ...metadata
  });
}));

// Start admin script run
router.post('/api/script-runs', catchAsync(async (req, res) => {
  const { scriptKey, params } = req.body || {};

  if (!scriptKey || typeof scriptKey !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'scriptKey is required'
    });
  }

  try {
    const run = await adminScriptRunner.startScriptRun(
      scriptKey,
      params || {},
      req.session.user.id
    );

    return res.status(202).json({
      success: true,
      run
    });
  } catch (error) {
    if (error.code === 'ACTIVE_RUN_EXISTS') {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }

    logger.warn('Invalid admin script run request', {
      adminId: req.session.user.id,
      scriptKey,
      error: error.message
    });

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}));

// List recent admin script runs
router.get('/api/script-runs', catchAsync(async (req, res) => {
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(rawLimit) ? rawLimit : 20;
  const runs = await adminScriptRunner.listRuns(limit);
  const activeRun = await adminScriptRunner.getExistingActiveRun();

  res.json({
    success: true,
    runs,
    activeRunId: activeRun ? activeRun.run_id : null
  });
}));

// Get specific admin script run
router.get('/api/script-runs/:runId', catchAsync(async (req, res) => {
  const runId = Number.parseInt(req.params.runId, 10);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid runId'
    });
  }

  const run = await adminScriptRunner.getRunById(runId);
  if (!run) {
    return res.status(404).json({
      success: false,
      error: 'Run not found'
    });
  }

  return res.json({
    success: true,
    run
  });
}));

// Get admin script run logs
router.get('/api/script-runs/:runId/logs', catchAsync(async (req, res) => {
  const runId = Number.parseInt(req.params.runId, 10);
  const afterSeq = Number.parseInt(req.query.afterSeq, 10);
  const rawLimit = Number.parseInt(req.query.limit, 10);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid runId'
    });
  }

  const run = await adminScriptRunner.getRunById(runId);
  if (!run) {
    return res.status(404).json({
      success: false,
      error: 'Run not found'
    });
  }

  const logs = await adminScriptRunner.getRunLogs(
    runId,
    Number.isInteger(afterSeq) ? afterSeq : 0,
    Number.isInteger(rawLimit) ? rawLimit : 300
  );

  const lastSeq = logs.length > 0 ? logs[logs.length - 1].seq : (Number.isInteger(afterSeq) ? afterSeq : 0);

  return res.json({
    success: true,
    runId,
    logs,
    lastSeq
  });
}));

router.get('/api/event-sync-status', catchAsync(async (req, res) => {
  const status = await resultUpdateService.getEventSyncStatus();

  res.json({
    success: true,
    status
  });
}));

// Add new predictor
router.post('/predictors', async (req, res, next) => {
  try {
    const { username, password, displayName, isAdmin, yearJoined } = req.body;
    
    logger.info(`Admin ${req.session.user.id} attempting to add new predictor: ${username}`);
    
    // Validate input
    if (!username || !password) {
      return res.redirect('/admin?error=' + encodeURIComponent('Username and password are required'));
    }
    
    // Validate password
    const passwordValidation = passwordService.validatePassword(password);
    if (!passwordValidation.isValid) {
      logger.warn(`Invalid password attempt for new user ${username}: ${passwordValidation.errors.join('. ')}`);
      return res.redirect(`/admin?error=${encodeURIComponent(passwordValidation.errors.join('. '))}`);
    }
    
    // Check if user already exists
    const existingUser = await predictorService.getPredictorByName(username);
    
    if (existingUser) {
      logger.warn(`Attempt to create duplicate user: ${username}`);
      return res.redirect('/admin?error=' + encodeURIComponent('User already exists'));
    }
    
    // Create new predictor
    const isAdminValue = isAdmin === 'on';
    await predictorService.createPredictor(username, password, displayName, isAdminValue, yearJoined);
    
    logger.info(`New predictor created: ${username} (admin: ${isAdminValue})`);
    
    res.redirect('/admin?success=Predictor added successfully');
  } catch (error) {
    // Handle validation errors from the service
    if (error.isOperational && error.errorCode === 'VALIDATION_ERROR') {
      logger.warn(`Validation error creating predictor: ${error.message}`);
      return res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
    
    // Only use next(error) for unexpected errors
    logger.error('Unexpected error creating predictor', { error: error.message });
    next(error);
  }
});

// Get predictions for a specific user
router.get('/predictions/:userId', catchAsync(async (req, res) => {
  const userId = req.params.userId;
  
  // Check if user exists
  const user = await predictorService.getPredictorById(userId);
  
  if (!user) {
    return res.redirect('/admin?error=' + encodeURIComponent('User not found'));
  }
  
  logger.debug(`Fetching predictions for user ${userId}`);
  
  // Get predictions for this user
  const predictions = await predictionService.getPredictionsForUser(userId);
  
  // Convert to a map format for the frontend
  const predictionsMap = {};
  predictions.forEach(pred => {
    const tippedTeam = pred.tipped_team
      || (pred.home_win_probability < 50 ? 'away' : 'home');

    predictionsMap[pred.match_id] = {
      probability: pred.home_win_probability,
      tipped_team: tippedTeam
    };
  });
  
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    predictions: predictionsMap
  });
}));

router.get('/predictions/:userId/round/:round', catchAsync(async (req, res) => {
  const userId = req.params.userId;

  const user = await predictorService.getPredictorById(userId);
  if (!user) {
    return res.redirect('/admin?error=' + encodeURIComponent('User not found'));
  }

  const { selectedYear: year } = await roundService.resolveYear(req.query.year);
  const matches = await matchService.getMatchesByRoundSelectionAndYear(req.params.round, year);
  const processedMatches = matchService.processMatchLockStatus(matches);
  const predictions = await predictionService.getPredictionsForUser(userId);
  const predictionsByMatchId = new Map(predictions.map((prediction) => [String(prediction.match_id), prediction]));

  const decoratedMatches = processedMatches.map((match) => {
    const prediction = predictionsByMatchId.get(String(match.match_id));
    const adminMetrics = buildAdminMetrics(prediction, match);

    if (!adminMetrics) {
      return match;
    }

    return {
      ...match,
      adminMetrics
    };
  });

  res.set('Cache-Control', 'no-store');
  res.json(decoratedMatches);
}));

// Make predictions on behalf of a user
router.post('/predictions/:userId/save', catchAsync(async (req, res) => {
  const userId = req.params.userId;
  const { matchId, probability, tippedTeam } = req.body;
  
  // Validate input
  if (!matchId || probability === undefined) {
    throw createValidationError('Missing required fields');
  }
  
  // Check if user exists
  const user = await predictorService.getPredictorById(userId);
  
  if (!user) {
    throw createNotFoundError('User');
  }
  
  logger.info(`Admin ${req.session.user.id} modifying prediction for user ${userId} on match ${matchId}`);
  
  // Check if this is a deletion request (empty string or null)
  if (probability === "" || probability === null) {
    await predictionService.deletePrediction(matchId, userId);
    logger.info(`Prediction deleted for user ${userId} on match ${matchId}`);
    return res.json({ success: true, action: 'deleted' });
  }
  
  // Sanitize probability value for actual predictions
  let prob = parseInt(probability);
  if (isNaN(prob)) prob = 50;
  if (prob < 0) prob = 0;
  if (prob > 100) prob = 100;
  
  await predictionService.savePrediction(matchId, userId, prob, {
    adminOverride: true,
    tippedTeam
  });
  
  logger.info(`Prediction saved for user ${userId} on match ${matchId}: ${prob}%`);
  
  res.json({ success: true });
}));

// Generate statistics page
router.get('/stats', catchAsync(async (req, res) => {
  logger.info(`Admin statistics accessed by user ${req.session.user.id}`);
  
  // Get all predictors
  const predictors = await getQuery(
    'SELECT predictor_id, name FROM predictors ORDER BY name'
  );
  
  // Get total predictions per user
  const predictionCounts = await getQuery(`
    SELECT predictor_id, COUNT(*) as count 
    FROM predictions 
    GROUP BY predictor_id
  `);
  
  // Create a map of predictor_id to prediction count
  const countsMap = {};
  predictionCounts.forEach(row => {
    countsMap[row.predictor_id] = row.count;
  });
  
  // Get matches with results
  const completedMatches = await getQuery(`
    SELECT m.*, 
           t1.name as home_team, 
           t2.name as away_team 
    FROM matches m
    JOIN teams t1 ON m.home_team_id = t1.team_id
    JOIN teams t2 ON m.away_team_id = t2.team_id
    WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL
    ORDER BY m.match_date DESC
  `);
  
  // Get all predictions for completed matches
  const predictions = await getQuery(`
    SELECT p.*, pr.name as predictor_name 
    FROM predictions p
    JOIN predictors pr ON p.predictor_id = pr.predictor_id
    JOIN matches m ON p.match_id = m.match_id
    WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL
  `);
  
  // Calculate accuracy for each predictor
  const predictorStats = {};
  
  predictors.forEach(predictor => {
    predictorStats[predictor.predictor_id] = {
      id: predictor.predictor_id,
      name: predictor.name,
      totalPredictions: countsMap[predictor.predictor_id] || 0,
      correct: 0,
      incorrect: 0,
      accuracy: 0
    };
  });
  
  // Process predictions
  predictions.forEach(prediction => {
    const match = completedMatches.find(m => m.match_id === prediction.match_id);
    
    if (match) {
      const homeWon = match.hscore > match.ascore;
      const awayWon = match.hscore < match.ascore;
      const tie = match.hscore === match.ascore;
      
      const correctPrediction = 
        (homeWon && prediction.home_win_probability > 50) || 
        (awayWon && prediction.home_win_probability < 50) || 
        (tie && prediction.home_win_probability === 50);
      
      const predictorId = prediction.predictor_id;
      
      if (correctPrediction) {
        predictorStats[predictorId].correct++;
      } else {
        predictorStats[predictorId].incorrect++;
      }
    }
  });
  
  // Calculate final accuracy
  Object.values(predictorStats).forEach(stats => {
    const total = stats.correct + stats.incorrect;
    stats.accuracy = total > 0 ? ((stats.correct / total) * 100).toFixed(1) : 0;
  });
  
  res.render('admin-stats', {
    predictorStats: Object.values(predictorStats).sort((a, b) => b.accuracy - a.accuracy),
    completedMatches,
  });
}));

// Export predictions route
router.get('/export/predictions', catchAsync(async (req, res) => {
  logger.info(`Predictions export initiated by admin ${req.session.user.id}`);
  
  // Get all predictions with related data
  const predictions = await predictionService.getAllPredictionsWithDetails();
  
  // Set headers for CSV download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=afl-predictions-export.csv');
  
  // Create CSV header with new metrics columns
  let csvData = 'Predictor,Round,Match Number,Match Date,Home Team,Away Team,Home Win %,Away Win %,Tipped Team,Home Score,Away Score,Correct,Tip Points,Brier Score,Bits Score\n';
  
  // Add prediction rows
  predictions.forEach(prediction => {
    const homeWon = prediction.hscore !== null && prediction.ascore !== null && 
                  prediction.hscore > prediction.ascore;
    const awayWon = prediction.hscore !== null && prediction.ascore !== null && 
                  prediction.hscore < prediction.ascore;
    const tie = prediction.hscore !== null && prediction.ascore !== null && 
              prediction.hscore === prediction.ascore;
    
    // Default tipped team for 50% predictions if not stored
    let tippedTeam = prediction.tipped_team || 'home';
    
    let correct = '';
    let tipPoints = 0;
    let brierScore = '';
    let bitsScore = '';
    
    if (prediction.hscore !== null && prediction.ascore !== null) {
      const homeWon = prediction.hscore > prediction.ascore;
      const awayWon = prediction.hscore < prediction.ascore;
      const tie = prediction.hscore === prediction.ascore;
      
      // Default tipped team for 50% predictions if not stored
      let tippedTeam = prediction.tipped_team || 'home';
      
      // Calculate tip points using scoring service
      tipPoints = scoringService.calculateTipPoints(
        prediction.home_win_probability, 
        prediction.hscore, 
        prediction.ascore, 
        tippedTeam
      );
      
      // Determine actual outcome for scoring
      const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
      
      // Calculate Brier score
      brierScore = scoringService.calculateBrierScore(
        prediction.home_win_probability, 
        actualOutcome
      ).toFixed(4);
      
      // Calculate Bits score
      bitsScore = scoringService.calculateBitsScore(
        prediction.home_win_probability, 
        actualOutcome
      ).toFixed(4);
      
      // Set correct class
      correct = tipPoints === 1 ? 'Yes' : 'No';
    }
    
    // Format date for CSV
    let matchDate = prediction.match_date;
    try {
      if (matchDate && matchDate.includes('T')) {
        const date = new Date(matchDate);
        matchDate = date.toLocaleDateString('en-AU');
      }
    } catch (error) {
      logger.error('Error formatting date for CSV export', { 
        matchDate, 
        error: error.message 
      });
    }
    
    // Show team name instead of 'home' or 'away'
    const displayTippedTeam = prediction.home_win_probability === 50 
      ? (tippedTeam === 'home' ? prediction.home_team : prediction.away_team)
      : '';
    
    csvData += `"${prediction.predictor_name}",`;
    csvData += `"${prediction.round_number}",`;
    csvData += `${prediction.match_number},`;
    csvData += `"${matchDate}",`;
    csvData += `"${prediction.home_team}",`;
    csvData += `"${prediction.away_team}",`;
    csvData += `${prediction.home_win_probability},`;
    csvData += `${100 - prediction.home_win_probability},`;
    csvData += `"${displayTippedTeam}",`;
    csvData += `${prediction.hscore || ''},`;
    csvData += `${prediction.ascore || ''},`;
    csvData += `"${correct}",`;
    csvData += `${tipPoints.toFixed(1)},`;
    csvData += `${brierScore},`;
    csvData += `${bitsScore}\n`;
  });
  
  // Send CSV data
  res.send(csvData);
}));

// Password reset route
router.post('/reset-password/:userId', async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const { newPassword } = req.body;
    
    logger.info(`Password reset requested for user ${userId} by admin ${req.session.user.id}`);
    
    // Validate input
    if (!newPassword) {
      return res.redirect('/admin?error=' + encodeURIComponent('New password is required'));
    }
    
    // Validate password
    const passwordValidation = passwordService.validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      logger.warn(`Invalid password in reset attempt for user ${userId}: ${passwordValidation.errors.join('. ')}`);
      return res.redirect(`/admin?error=${encodeURIComponent(passwordValidation.errors.join('. '))}`);
    }
    
    // Check if user exists
    const user = await predictorService.getPredictorById(userId);
    
    if (!user) {
      return res.redirect('/admin?error=' + encodeURIComponent('User not found'));
    }
    
    // Reset password
    await predictorService.resetPassword(userId, newPassword);
    
    logger.info(`Password reset successful for user ${userId}`);
    
    res.redirect('/admin?success=Password reset successfully');
  } catch (error) {
    logger.error('Unexpected error resetting password', { 
      userId: req.params.userId,
      error: error.message 
    });
    next(error);
  }
});

// API refresh route
router.post('/api-refresh', catchAsync(async (req, res) => {
  const year = req.body.year || new Date().getFullYear();
  const forceScoreUpdate = req.body.forceScoreUpdate === 'true' || req.body.forceScoreUpdate === true;
  
  logger.info(`API refresh initiated by admin ${req.session.user.id} for year ${year}`, {
    forceScoreUpdate
  });
  
  // Import the refreshAPIData function
  const { refreshAPIData } = require('../scripts/automation/api-refresh');
  
  // Call the function with the year and options object
  const result = await refreshAPIData(parseInt(year), { forceScoreUpdate });
  
  logger.info(`API refresh completed for year ${year}`, {
    success: result.success,
    insertCount: result.insertCount,
    updateCount: result.updateCount,
    scoresUpdated: result.scoresUpdated
  });
  
  return res.json(result);
}));

// Delete user route
router.post('/delete-user/:userId', async (req, res, next) => {
  try {
    const userId = req.params.userId;
    
    logger.info(`User deletion requested for user ${userId} by admin ${req.session.user.id}`);
    
    // Don't allow deleting the current logged-in user
    if (parseInt(userId) === req.session.user.id) {
      return res.redirect('/admin?error=' + encodeURIComponent('You cannot delete your own account'));
    }
    
    // Check if user exists
    const user = await predictorService.getPredictorById(userId);
    
    if (!user) {
      return res.redirect('/admin?error=' + encodeURIComponent('User not found'));
    }
    
    // Delete the user and their predictions
    await predictorService.deletePredictor(userId);
    
    logger.info(`User ${userId} deleted successfully`);
    
    res.redirect('/admin?success=User deleted successfully');
  } catch (error) {
    logger.error('Unexpected error deleting user', { 
      userId: req.params.userId,
      error: error.message 
    });
    next(error);
  }
});

// Database export route
router.get('/export/database', catchAsync(async (req, res) => {
  logger.info(`Database export initiated by admin ${req.session.user.id}`);

  const snapshot = await adminDatabaseService.createDatabaseSnapshot({
    prefix: 'afl_predictions'
  });

  await new Promise((resolve, reject) => {
    res.download(snapshot.path, snapshot.filename, async (downloadErr) => {
      try {
        await adminDatabaseService.removeFileIfExists(snapshot.path);
      } catch (cleanupError) {
        logger.error('Error deleting temporary database export', {
          error: cleanupError.message,
          path: snapshot.path
        });
      }

      if (downloadErr) {
        logger.error('Error sending database file', {
          error: downloadErr.message,
          adminId: req.session.user.id
        });
        if (!res.headersSent) {
          reject(downloadErr);
          return;
        }

        resolve();
        return;
      }

      logger.info(`Database export successful for admin ${req.session.user.id}`);
      resolve();
    });
  });
}));

// Configure multer storage for database uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(__dirname, '..', 'data', 'temp');
    // Ensure the temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `temp_upload_${timestamp}.db`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: function(req, file, cb) {
    // Check file extensions
    const filetypes = /db|sqlite|sqlite3/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (extname) {
      return cb(null, true);
    }
    
    cb(new Error('Only SQLite database files are allowed'));
  }
});

// Database upload route
router.post('/upload-database', upload.single('databaseFile'), catchAsync(async (req, res) => {
  logger.info(`Database upload initiated by admin ${req.session.user.id}`);
  
  if (!req.file) {
    throw createValidationError('No file uploaded');
  }

  const enterMaintenanceMode = req.app?.locals?.enterDatabaseReplacementMode
    || (async () => {
      if (req.app?.locals) {
        req.app.locals.databaseReplacementInProgress = true;
      }
    });
  const exitMaintenanceMode = req.app?.locals?.exitDatabaseReplacementMode
    || (() => {
      if (req.app?.locals) {
        req.app.locals.databaseReplacementInProgress = false;
      }
    });

  await enterMaintenanceMode();

  try {
    const activeRun = await adminScriptRunner.getExistingActiveRun();
    if (activeRun) {
      exitMaintenanceMode();
      throw new AppError(
        'Database upload is unavailable while an admin script is running',
        409,
        'ACTIVE_RUN_EXISTS'
      );
    }

    const eventSyncStatus = await resultUpdateService.getEventSyncStatus();
    if (eventSyncStatus?.activeJob) {
      exitMaintenanceMode();
      throw new AppError(
        'Database upload is unavailable while result-update work is active',
        409,
        'ACTIVE_RESULT_UPDATE_EXISTS'
      );
    }
  } catch (error) {
    exitMaintenanceMode();
    throw error;
  }

  let replacementResult;
  try {
    replacementResult = await adminDatabaseService.replaceDatabaseFromUpload(req.file.path);
  } catch (error) {
    if (error.requiresProcessRestart) {
      logger.error('Database replacement failed after the live database was closed', {
        adminId: req.session.user.id,
        error: error.message
      });

      if (process.env.NODE_ENV !== 'test') {
        res.on('finish', () => {
          setImmediate(() => {
            logger.info('Exiting process after fatal database replacement failure');
            process.exit(1);
          });
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Database replacement failed and the application will restart shortly.'
      });
    }

    exitMaintenanceMode();
    throw error;
  }

  logger.info('Database upload completed successfully', {
    adminId: req.session.user.id,
    backupPath: replacementResult.backupPath
  });

  if (process.env.NODE_ENV !== 'test') {
    res.on('finish', () => {
      setImmediate(() => {
        logger.info('Exiting process for restart after database replacement');
        process.exit(0);
      });
    });
  }

  return res.json({
    success: true,
    message: 'Database uploaded successfully. The application will restart shortly.'
  });
}));

// Set featured predictors for homepage
router.post('/set-featured-predictors', async (req, res, next) => {
  try {
    const selectedPredictorId = req.body.predictorId
      || (Array.isArray(req.body.predictorIds) ? req.body.predictorIds[0] : req.body.predictorIds);

    logger.info(`Admin ${req.session.user.id} setting featured predictor: ${selectedPredictorId || 'none'}`);

    if (!selectedPredictorId) {
      return res.redirect('/admin?error=' + encodeURIComponent('Please select a featured predictor'));
    }

    const predictor = await getOne(
      'SELECT predictor_id FROM predictors WHERE predictor_id = ? AND active = 1',
      [selectedPredictorId]
    );

    if (!predictor) {
      return res.redirect('/admin?error=' + encodeURIComponent('Selected predictor must be active'));
    }

    // Reset all predictors to not homepage available
    await runQuery('UPDATE predictors SET homepage_available = 0, is_default_featured = 0');

    // Set the selected predictor as homepage available and default featured.
    await runQuery(
      'UPDATE predictors SET homepage_available = 1, is_default_featured = 1 WHERE predictor_id = ?',
      [selectedPredictorId]
    );

    logger.info(`Featured predictor updated: ${selectedPredictorId}`);

    res.redirect('/admin?success=Featured predictor updated successfully');
  } catch (error) {
    logger.error('Unexpected error setting featured predictors', {
      predictorId: req.body.predictorId,
      error: error.message
    });
    next(error);
  }
});

// Get all predictors with active status
router.get('/api/predictors', catchAsync(async (req, res) => {
  const predictors = await getQuery(
    'SELECT predictor_id, name, display_name, active, year_joined FROM predictors ORDER BY name'
  );

  res.json({ predictors });
}));

// Toggle predictor active status
router.post('/api/predictors/:predictorId/toggle-active', catchAsync(async (req, res) => {
  const predictorId = req.params.predictorId;
  const { active } = req.body;

  logger.info(`Admin ${req.session.user.id} toggling active status for predictor ${predictorId} to ${active}`);

  // Validate input
  if (active === undefined) {
    throw createValidationError('Active status is required');
  }

  // Check if predictor exists
  const predictor = await predictorService.getPredictorById(predictorId);

  if (!predictor) {
    throw createNotFoundError('Predictor');
  }

  // Update active status
  await runQuery(
    'UPDATE predictors SET active = ? WHERE predictor_id = ?',
    [active ? 1 : 0, predictorId]
  );

  logger.info(`Predictor ${predictorId} active status updated to ${active}`);

  res.json({ success: true });
}));

module.exports = router;
