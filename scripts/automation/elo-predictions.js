const { runQuery, getQuery, getOne } = require('../../models/db');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

/**
 * Run ELO predictions for matches that haven't started
 */
async function runEloPredictions() {
  const currentYear = new Date().getFullYear();
  const predictorId = 6; // ELO model predictor ID
  
  logger.info(`Starting ELO predictions for year ${currentYear}`);
  
  try {
    // Step 1: Run Python ELO prediction script (now writes directly to database)
    // Get project root directory (two levels up from automation folder)
    const projectRoot = path.join(__dirname, '../..');
    const modelPath = path.join(projectRoot, 'data/afl_elo_trained_to_2024.json');
    const marginModelPath = path.join(projectRoot, 'data/afl_elo_margin_only_trained_to_2024.json');
    const dbPath = path.join(projectRoot, 'data/database/afl_predictions.db');
    const outputDir = path.join(projectRoot, 'data/temp');
    
    // Ensure temp directory exists for rating history CSV
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const pythonArgs = [
      'scripts/elo_predict_combined.py',
      '--start-year', currentYear.toString(),
      '--standard-model', modelPath,
      '--margin-model', marginModelPath,
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--predictor-id', predictorId.toString()
    ];
    
    logger.info(`Running Python ELO script with args: ${pythonArgs.join(' ')}`);
    
    const pythonResult = await runPythonScript('python3', pythonArgs, projectRoot);
    
    if (pythonResult.exitCode !== 0) {
      throw new Error(`Python script failed: ${pythonResult.stderr}`);
    }
    
    logger.info('Python ELO script completed successfully');
    
    // Step 2: Verify predictions were saved to database
    const predictionCount = await getOne(
      `SELECT COUNT(*) as count FROM predictions 
       WHERE predictor_id = ? 
       AND match_id IN (
         SELECT match_id FROM matches 
         WHERE year = ? 
         AND (complete = 0 OR complete IS NULL)
       )`,
      [predictorId, currentYear]
    );
    
    logger.info(`Found ${predictionCount.count} ELO predictions in database for year ${currentYear}`);
    
    // Step 3: Verify that rating history file exists for the ELO chart
    const ratingHistoryPath = path.join(outputDir, `afl_elo_rating_history_from_${currentYear}.csv`);
    if (fs.existsSync(ratingHistoryPath)) {
      logger.info(`ELO rating history preserved at: ${ratingHistoryPath}`);
    } else {
      logger.warn(`ELO rating history file not found at: ${ratingHistoryPath}`);
    }
    
    return {
      success: true,
      message: `ELO predictions updated: ${predictionCount.count} predictions saved to database`,
      predictionsCount: predictionCount.count
    };
    
  } catch (error) {
    logger.error('Error running ELO predictions', { error: error.message });
    throw error;
  }
}

/**
 * Run Python script and return result
 */
function runPythonScript(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout,
        stderr
      });
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = { runEloPredictions };

// Allow running directly
if (require.main === module) {
  runEloPredictions()
    .then(result => {
      console.log(result.message);
      process.exit(0);
    })
    .catch(error => {
      console.error('ELO predictions failed:', error.message);
      process.exit(1);
    });
}