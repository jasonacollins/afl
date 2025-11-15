const express = require('express');
const router = express.Router();
const { catchAsync } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * GET /api/simulation/years
 * Get list of available years with simulation data
 */
router.get('/years', catchAsync(async (req, res) => {
  try {
    const simulationDir = path.join(__dirname, '../data/simulations');

    // Check if directory exists
    try {
      await fs.access(simulationDir);
    } catch (error) {
      // Directory doesn't exist yet
      return res.json({
        success: true,
        years: [],
        count: 0
      });
    }

    // Read directory
    const files = await fs.readdir(simulationDir);

    // Extract years from filenames (season_simulation_YYYY.json or season_simulation_YYYY_from_scratch.json)
    const years = files
      .filter(file => file.startsWith('season_simulation_') && file.endsWith('.json'))
      .map(file => {
        const match = file.match(/season_simulation_(\d{4})(?:_from_scratch)?\.json/);
        return match ? parseInt(match[1]) : null;
      })
      .filter(year => year !== null)
      .sort((a, b) => b - a); // Sort descending

    logger.info('Available simulation years requested', {
      yearsCount: years.length,
      years: years
    });

    res.json({
      success: true,
      years: years,
      count: years.length
    });
  } catch (error) {
    logger.error('Failed to get available simulation years', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve available simulation years'
    });
  }
}));

/**
 * GET /api/simulation/:year
 * Get simulation results for a specific year
 */
router.get('/:year', catchAsync(async (req, res) => {
  const year = parseInt(req.params.year);

  if (isNaN(year) || year < 2020 || year > new Date().getFullYear() + 5) {
    return res.status(400).json({
      success: false,
      error: 'Invalid year parameter. Must be a valid year between 2020 and current year + 5.'
    });
  }

  logger.info(`Simulation data requested for year ${year}`, {
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  try {
    // Try standard filename first, then from_scratch variant
    let filePath = path.join(__dirname, '../data/simulations', `season_simulation_${year}.json`);

    try {
      await fs.access(filePath);
    } catch (error) {
      // Try from_scratch variant
      const fromScratchPath = path.join(__dirname, '../data/simulations', `season_simulation_${year}_from_scratch.json`);
      try {
        await fs.access(fromScratchPath);
        filePath = fromScratchPath;
      } catch (err) {
        logger.warn(`Simulation data not found for year ${year}`, { filePath, fromScratchPath });
        return res.status(404).json({
          success: false,
          error: `No simulation data available for year ${year}`,
          year: year
        });
      }
    }

    // Read and parse the file
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const simulationData = JSON.parse(fileContent);

    // Check if ladder position data exists
    const hasLadderPositionData = simulationData.results &&
                                   simulationData.results[0] &&
                                   simulationData.results[0].ladder_position_probabilities;

    logger.info(`Simulation data loaded for year ${year}`, {
      numSimulations: simulationData.num_simulations,
      teamsCount: simulationData.results.length,
      completedMatches: simulationData.completed_matches,
      remainingMatches: simulationData.remaining_matches,
      filePath: filePath,
      hasLadderPositionData: hasLadderPositionData
    });

    // Set cache headers (cache for 1 hour, or less if simulation is very recent)
    const cacheMaxAge = 3600; // 1 hour
    res.set({
      'Cache-Control': `public, max-age=${cacheMaxAge}`,
      'Content-Type': 'application/json'
    });

    res.json({
      success: true,
      ...simulationData
    });
  } catch (error) {
    logger.error(`Failed to get simulation data for year ${year}`, {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve simulation data',
      year: year
    });
  }
}));

/**
 * GET /api/simulation/:year/summary
 * Get summarized simulation results for a specific year
 */
router.get('/:year/summary', catchAsync(async (req, res) => {
  const year = parseInt(req.params.year);

  if (isNaN(year) || year < 2020 || year > new Date().getFullYear() + 5) {
    return res.status(400).json({
      success: false,
      error: 'Invalid year parameter'
    });
  }

  try {
    // Try standard filename first, then from_scratch variant
    let filePath = path.join(__dirname, '../data/simulations', `season_simulation_${year}.json`);

    try {
      await fs.access(filePath);
    } catch (error) {
      // Try from_scratch variant
      const fromScratchPath = path.join(__dirname, '../data/simulations', `season_simulation_${year}_from_scratch.json`);
      try {
        await fs.access(fromScratchPath);
        filePath = fromScratchPath;
      } catch (err) {
        return res.status(404).json({
          success: false,
          error: `No simulation data available for year ${year}`,
          year: year
        });
      }
    }

    // Read and parse the file
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const simulationData = JSON.parse(fileContent);

    // Extract summary statistics
    const summary = {
      year: simulationData.year,
      num_simulations: simulationData.num_simulations,
      completed_matches: simulationData.completed_matches,
      remaining_matches: simulationData.remaining_matches,
      last_updated: simulationData.last_updated,
      top_5_premiership_contenders: simulationData.results
        .slice(0, 5)
        .map(r => ({
          team: r.team,
          premiership_probability: r.premiership_probability,
          finals_probability: r.finals_probability
        }))
    };

    res.json({
      success: true,
      ...summary
    });
  } catch (error) {
    logger.error(`Failed to get simulation summary for year ${year}`, {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve simulation summary',
      year: year
    });
  }
}));

module.exports = router;
