const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getQuery, getOne, runQuery } = require('../models/db');
const { isAuthenticated, isAdmin } = require('./auth');
const sqlite3 = require('sqlite3').verbose();
const scoringService = require('../services/scoring-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const predictionService = require('../services/prediction-service');
const predictorService = require('../services/predictor-service');
const passwordService = require('../services/password-service'); // ADD THIS LINE
const { catchAsync, createValidationError, createNotFoundError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Require authentication and admin for all admin routes
router.use(isAuthenticated);
router.use(isAdmin);

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
  
  if (!Array.isArray(predictorIds)) {
    return res.status(400).json({ error: 'predictorIds must be an array' });
  }
  
  // First, reset all predictors to not excluded
  await runQuery('UPDATE predictors SET stats_excluded = 0');
  
  // Then set the specified predictors as excluded
  if (predictorIds.length > 0) {
    const placeholders = predictorIds.map(() => '?').join(',');
    await runQuery(
      `UPDATE predictors SET stats_excluded = 1 WHERE predictor_id IN (${placeholders})`,
      predictorIds
    );
  }
  
  logger.info(`Admin ${req.session.user.id} updated excluded predictors: ${predictorIds.join(', ')}`);
  
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
  // Get selected year or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = req.query.year ? parseInt(req.query.year) : currentYear;
  
  logger.info(`Admin dashboard accessed by user ${req.session.user.id}`);
  
  // Get all available years
  const years = await getQuery(
    'SELECT DISTINCT year FROM matches ORDER BY year DESC'
  );
  
  // Get all predictors
  const predictors = await predictorService.getAllPredictors();
  
  // Get all rounds for the selected year
  const rounds = await roundService.getRoundsForYear(selectedYear);
  
  // Get featured predictor IDs
  const featuredPredictionsService = require('../services/featured-predictions');
  const featuredPredictorIds = await featuredPredictionsService.getHomepageAvailablePredictorIds();
  
  res.render('admin', {
    predictors,
    rounds,
    years,
    selectedYear,
    selectedUser: null,
    featuredPredictorIds,
    success: req.query.success || null,
    error: req.query.error || null,
    isAdmin: true
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
    predictionsMap[pred.match_id] = pred.home_win_probability;
  });
  
  res.json({
    success: true,
    predictions: predictionsMap
  });
}));

// Make predictions on behalf of a user
router.post('/predictions/:userId/save', catchAsync(async (req, res) => {
  const userId = req.params.userId;
  const { matchId, probability } = req.body;
  
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
  
await predictionService.savePrediction(matchId, userId, prob, { adminOverride: true });
  
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
  const path = require('path');
  const fs = require('fs');
  
  logger.info(`Database export initiated by admin ${req.session.user.id}`);
  
  // Get database path from models/db.js
  const dbPath = require('../models/db').dbPath || path.join(__dirname, '../data/database/afl_predictions.db');
  
  // Get current timestamp for filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `afl_predictions_${timestamp}.db`;
  const backupPath = path.join(__dirname, '..', 'data', filename);
  
  // Copy the database file (this is safer than running the backup API)
  fs.copyFile(dbPath, backupPath, (err) => {
    if (err) {
      logger.error('Error creating database copy', { 
        error: err,
        adminId: req.session.user.id 
      });
      throw new Error('Failed to create database backup');
    }
    
    // Send the file for download
    res.download(backupPath, filename, (downloadErr) => {
      if (downloadErr) {
        logger.error('Error sending database file', { 
          error: downloadErr,
          adminId: req.session.user.id 
        });
      } else {
        logger.info(`Database export successful for admin ${req.session.user.id}`);
      }
      
      // Clean up - delete the temporary file after download
      fs.unlink(backupPath, (unlinkErr) => {
        if (unlinkErr) {
          logger.error('Error deleting temp database file', { 
            error: unlinkErr,
            path: backupPath 
          });
        }
      });
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
  
  // Get path to uploaded temp file and database
  const uploadedFilePath = req.file.path;
  const dbModule = require('../models/db');
  const dbPath = dbModule.dbPath;
  
  try {
    // Create backup of current database first
    const backupDir = path.join(__dirname, '..', 'data', 'database', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup_${timestamp}.db`);
    
    // Copy current database to backup location
    fs.copyFileSync(dbPath, backupPath);
    logger.info(`Database backed up to ${backupPath}`);
    
    // Send successful response before performing database replacement
    // This prevents client-side errors when the server restarts
    res.json({ 
      success: true, 
      message: 'Database uploaded successfully. The application will restart shortly.' 
    });
    
    // Allow time for the response to be sent
    setTimeout(() => {
      logger.info('Performing database replacement and server restart');
      
      try {
        // Replace database file
        fs.copyFileSync(uploadedFilePath, dbPath);
        logger.info(`Database replaced with uploaded file`);
        
        // Clean up temp file
        fs.unlinkSync(uploadedFilePath);
        
        // Exit the process - Docker/PM2 will restart the application
        logger.info('Exiting process for restart after database replacement');
        process.exit(0);
      } catch (error) {
        logger.error('Error during database replacement', { error: error.message });
        // We can't send an error response here since we've already sent a success response
      }
    }, 1000); // Wait 1 second before replacing the database
    
  } catch (error) {
    logger.error('Error handling database upload', { error: error.message });
    
    // Clean up temp file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false, 
      message: `Error handling upload: ${error.message}` 
    });
  }
}));

// Set featured predictors for homepage
router.post('/set-featured-predictors', async (req, res, next) => {
  try {
    const { predictorIds } = req.body;
    const selectedIds = Array.isArray(predictorIds) ? predictorIds : (predictorIds ? [predictorIds] : []);
    
    logger.info(`Admin ${req.session.user.id} setting featured predictors: ${selectedIds.join(', ')}`);
    
    // Reset all predictors to not homepage available
    await runQuery('UPDATE predictors SET homepage_available = 0, is_default_featured = 0');
    
    // Set selected predictors as homepage available
    if (selectedIds.length > 0) {
      const placeholders = selectedIds.map(() => '?').join(',');
      await runQuery(
        `UPDATE predictors SET homepage_available = 1 WHERE predictor_id IN (${placeholders})`,
        selectedIds
      );
      
      // Set the first selected predictor as default featured
      await runQuery(
        'UPDATE predictors SET is_default_featured = 1 WHERE predictor_id = ?',
        [selectedIds[0]]
      );
    }
    
    logger.info(`Featured predictors updated: ${selectedIds.join(', ')}`);
    
    res.redirect('/admin?success=Featured predictors updated successfully');
  } catch (error) {
    logger.error('Unexpected error setting featured predictors', { 
      predictorIds: req.body.predictorIds,
      error: error.message 
    });
    next(error);
  }
});

module.exports = router;
