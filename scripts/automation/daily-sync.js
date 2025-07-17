const { refreshAPIData } = require('./api-refresh');
const { runEloPredictions } = require('./elo-predictions');
const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../../utils/logger');

/**
 * Regenerate ELO historical data with new match results
 */
async function regenerateEloHistory() {
  logger.info('Regenerating ELO historical data...');
  
  return new Promise((resolve, reject) => {
    // Get project root directory (two levels up from automation folder)
    const projectRoot = path.join(__dirname, '../..');
    const modelPath = path.join(projectRoot, 'data/models/win/afl_elo_win_trained_to_2024.json');
    const dbPath = path.join(projectRoot, 'data/database/afl_predictions.db');
    const outputDir = path.join(projectRoot, 'data/historical');
    
    const pythonProcess = spawn('python3', [
      'scripts/elo_history_generator.py',
      '--model-path', modelPath,
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--output-prefix', 'afl_elo_complete_history'
    ], { cwd: projectRoot });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      logger.debug('ELO History Generator output', { output: data.toString().trim() });
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.error('ELO History Generator error', { error: data.toString().trim() });
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        logger.info('ELO historical data regeneration completed successfully');
        resolve({ success: true, message: 'ELO history updated' });
      } else {
        logger.error('ELO history generator failed', { 
          exitCode: code, 
          stderr: stderr,
          stdout: stdout 
        });
        reject(new Error(`ELO history generator failed with code ${code}: ${stderr}`));
      }
    });
    
    pythonProcess.on('error', (error) => {
      logger.error('Failed to start ELO history generator', { error: error.message });
      reject(error);
    });
  });
}

async function dailySync() {
  logger.info(`Running daily sync at ${new Date().toISOString()}`);
  try {
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Step 1: API refresh (default options with forceScoreUpdate = false)
    logger.info('Starting API data refresh...');
    const apiResults = await refreshAPIData(currentYear, { forceScoreUpdate: false });
    logger.info('API refresh complete', { results: apiResults });
    
    // Step 2: ELO predictions (only if API refresh succeeded)
    logger.info('Starting ELO predictions...');
    const eloResults = await runEloPredictions();
    logger.info('ELO predictions complete', { message: eloResults.message, predictionsCount: eloResults.predictionsCount });
    
    // Step 3: Always regenerate ELO historical data to ensure consistency
    logger.info('Regenerating ELO historical data...');
    const historyResults = await regenerateEloHistory();
    logger.info('ELO history regeneration complete', { message: historyResults.message });
    
    logger.info('Daily sync completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Daily sync failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

dailySync();