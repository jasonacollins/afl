const express = require('express');
const router = express.Router();
const { catchAsync } = require('../utils/error-handler');
const eloService = require('../services/elo-service');
const { logger } = require('../utils/logger');

/**
 * GET /api/elo/ratings/range
 * Get ELO ratings data for a year range
 * Query parameters: startYear (YYYY), endYear (YYYY)
 */
router.get('/ratings/range', catchAsync(async (req, res) => {
  const { startYear, endYear } = req.query;
  
  if (!startYear || !endYear) {
    return res.status(400).json({
      error: 'Both startYear and endYear query parameters are required.'
    });
  }

  const start = parseInt(startYear);
  const end = parseInt(endYear);
  
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).json({
      error: 'Invalid year values. Must be valid 4-digit years.'
    });
  }

  if (start < 1990 || end > new Date().getFullYear() + 1) {
    return res.status(400).json({
      error: 'Years must be between 1990 and current year + 1.'
    });
  }

  if (start > end) {
    return res.status(400).json({
      error: 'Start year must be before or equal to end year.'
    });
  }

  logger.info(`ELO ratings requested for year range ${start} to ${end}`, { 
    userAgent: req.get('User-Agent'),
    ip: req.ip 
  });

  try {
    logger.info(`Processing ELO request for year range ${start} to ${end}`);
    const eloData = await eloService.getEloRatingsForYearRange(start, end);
    
    logger.info(`ELO data processed for year range ${start} to ${end}`, {
      dataPoints: eloData.data.length,
      teamsCount: eloData.teams.length,
      yearRange: eloData.yearRange
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
      startYear: start,
      endYear: end,
      ...eloData
    });
  } catch (error) {
    logger.error(`Failed to get ELO ratings for year range ${start} to ${end}`, { 
      error: error.message,
      stack: error.stack 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve ELO ratings data for year range',
      startYear: start,
      endYear: end
    });
  }
}));

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