const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getOne, runQuery } = require('../models/db');
const predictorService = require('../services/predictor-service');
const roundService = require('../services/round-service');
const matchService = require('../services/match-service');
const { catchAsync, createValidationError, createUnauthorizedError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

// Add rate limiting
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Login page (GET)
router.get('/login', (req, res) => {
  if (req.session.user) {
    logger.info(`User ${req.session.user.id} already logged in, redirecting to predictions`);
    return res.redirect('/predictions');
  }
  res.render('index', { error: null });
});

// Login submission (POST)
router.post('/login', loginLimiter, catchAsync(async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    logger.warn('Login attempt with missing credentials');
    return res.render('index', { error: 'Username and password are required' });
  }

  // Check if user exists
  const user = await predictorService.getPredictorByName(username);

  if (!user) {
    logger.warn(`Failed login attempt for non-existent user: ${username}`);
    return res.render('index', { error: 'Invalid username or password' });
  }

  // Validate password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  
  if (!isPasswordValid) {
    logger.warn(`Failed login attempt for user: ${username} - invalid password`);
    return res.render('index', { error: 'Invalid username or password' });
  }

  // Set session data
  req.session.user = {
    id: user.predictor_id,
    name: user.name,
    display_name: user.display_name
  };
  req.session.isAdmin = user.is_admin === 1;

  logger.info(`User ${user.predictor_id} (${user.name}) logged in successfully`);

  // Redirect based on role
  if (user.is_admin === 1) {
    res.redirect('/admin');
  } else {
    res.redirect('/predictions');
  }
}));

// Logout
router.get('/logout', (req, res) => {
  const userId = req.session.user ? req.session.user.id : 'unknown';
  
  req.session.destroy(err => {
    if (err) {
      logger.error('Error destroying session during logout', { userId, error: err });
    } else {
      logger.info(`User ${userId} logged out successfully`);
    }
    res.redirect('/login');
  });
});

// Middleware to require authentication
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    logger.debug('Unauthenticated access attempt', { 
      path: req.originalUrl,
      ip: req.ip
    });
    res.redirect('/login');
  }
}

// Middleware to require admin privileges
function isAdmin(req, res, next) {
  if (req.session.user && req.session.isAdmin) {
    next();
  } else {
    logger.warn('Unauthorized admin access attempt', {
      userId: req.session.user ? req.session.user.id : 'anonymous',
      path: req.originalUrl,
      ip: req.ip
    });
    res.status(403).render('error', { 
      error: 'Admin access required' 
    });
  }
}

// Route to fetch featured predictions for a specific round
router.get('/featured-predictions/:round', catchAsync(async (req, res) => {
  const round = req.params.round;
  const { selectedYear: year } = await roundService.resolveYear(req.query.year);
  const predictorId = req.query.predictorId;
  
  const featuredPredictionsService = require('../services/featured-predictions');
  
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

module.exports = router;
module.exports.isAuthenticated = isAuthenticated;
module.exports.isAdmin = isAdmin;
