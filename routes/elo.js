const express = require('express');
const router = express.Router();
const { catchAsync } = require('../utils/error-handler');
const eloService = require('../services/elo-service');
const { logger } = require('../utils/logger');

/**
 * GET /api/elo/ratings/:year
 * Get ELO ratings data for a specific year
 */
router.get('/ratings/:year', catchAsync(async (req, res) => {
  const year = parseInt(req.params.year);
  
  if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
    return res.status(400).json({
      error: 'Invalid year parameter. Must be a valid year between 1900 and current year + 1.'
    });
  }

  logger.info(`ELO ratings requested for year ${year}`, { 
    userAgent: req.get('User-Agent'),
    ip: req.ip 
  });

  try {
    logger.info(`Processing ELO request for year ${year}`);
    const eloData = await eloService.getEloRatingsForYear(year);
    
    logger.info(`ELO data processed for year ${year}`, {
      dataPoints: eloData.data.length,
      teamsCount: eloData.teams.length,
      firstRound: eloData.data[0]?.round
    });
    
    // Disable cache for debugging
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Type': 'application/json'
    });
    
    res.json({
      success: true,
      year: year,
      ...eloData
    });
  } catch (error) {
    logger.error(`Failed to get ELO ratings for year ${year}`, { 
      error: error.message,
      stack: error.stack 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve ELO ratings data',
      year: year
    });
  }
}));

/**
 * GET /api/elo/years
 * Get list of available years for ELO data
 */
router.get('/years', catchAsync(async (req, res) => {
  try {
    const availableYears = eloService.getAvailableYears();
    
    logger.info('Available ELO years requested', { 
      yearsCount: availableYears.length,
      years: availableYears 
    });

    res.set({
      'Cache-Control': 'public, max-age=7200', // Cache for 2 hours
      'Content-Type': 'application/json'
    });
    
    res.json({
      success: true,
      years: availableYears,
      count: availableYears.length
    });
  } catch (error) {
    logger.error('Failed to get available ELO years', { 
      error: error.message,
      stack: error.stack 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve available years'
    });
  }
}));

module.exports = router;