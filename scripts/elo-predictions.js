const { runQuery, getQuery, getOne } = require('../models/db');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { logger } = require('../utils/logger');

/**
 * Run ELO predictions for matches that haven't started
 */
async function runEloPredictions() {
  const currentYear = new Date().getFullYear();
  const predictorId = 6; // ELO model predictor ID
  
  logger.info(`Starting ELO predictions for year ${currentYear}`);
  
  try {
    // Step 1: Find the last completed match date for current year
    const lastCompletedMatch = await getOne(`
      SELECT match_date 
      FROM matches 
      WHERE year = ? AND (complete = 100 OR (hscore IS NOT NULL AND ascore IS NOT NULL))
      ORDER BY match_date DESC 
      LIMIT 1
    `, [currentYear]);
    
    let startDate = `${currentYear}-01-01`; // Fallback to start of year
    if (lastCompletedMatch && lastCompletedMatch.match_date) {
      startDate = lastCompletedMatch.match_date.split('T')[0]; // Get date part only
    }
    
    logger.info(`Using start date: ${startDate} for ELO predictions`);
    
    // Step 2: Run Python ELO prediction script
    const modelPath = path.join(__dirname, 'afl_elo_trained_to_2024.json');
    const dbPath = path.join(__dirname, '../data/afl_predictions.db');
    const outputDir = path.join(__dirname, '../data/temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const pythonArgs = [
      'afl_elo_predictions.py',
      '--start-year', currentYear.toString(),
      '--model-path', modelPath,
      '--db-path', dbPath,
      '--output-dir', outputDir
    ];
    
    logger.info(`Running Python ELO script with args: ${pythonArgs.join(' ')}`);
    
    const pythonResult = await runPythonScript('python3', pythonArgs, __dirname);
    
    if (pythonResult.exitCode !== 0) {
      throw new Error(`Python script failed: ${pythonResult.stderr}`);
    }
    
    logger.info('Python ELO script completed successfully');
    
    // Step 3: Parse CSV output
    const csvPath = path.join(outputDir, `afl_elo_predictions_from_${currentYear}.csv`);
    
    if (!fs.existsSync(csvPath)) {
      throw new Error(`ELO predictions CSV not found at: ${csvPath}`);
    }
    
    const predictions = await parsePredictionsCSV(csvPath);
    logger.info(`Parsed ${predictions.length} ELO predictions from CSV`);
    
    // Step 4: Filter predictions for database update
    // Only update matches that haven't started and have teams assigned
    const updateableMatches = await getQuery(`
      SELECT match_id 
      FROM matches 
      WHERE year = ? 
        AND (complete = 0 OR complete IS NULL)
        AND home_team_id IS NOT NULL 
        AND away_team_id IS NOT NULL
        AND match_date >= ?
    `, [currentYear, startDate]);
    
    const updateableMatchIds = new Set(updateableMatches.map(m => m.match_id));
    
    const filteredPredictions = predictions.filter(pred => 
      updateableMatchIds.has(pred.match_id)
    );
    
    logger.info(`Filtered to ${filteredPredictions.length} predictions for database update`);
    
    // Step 5: Delete existing ELO predictions for these matches
    if (filteredPredictions.length > 0) {
      const matchIds = filteredPredictions.map(p => p.match_id);
      const placeholders = matchIds.map(() => '?').join(',');
      
      const deleteResult = await runQuery(
        `DELETE FROM predictions 
         WHERE predictor_id = ? AND match_id IN (${placeholders})`,
        [predictorId, ...matchIds]
      );
      
      logger.info(`Deleted ${deleteResult.changes} existing ELO predictions`);
      
      // Step 6: Insert new ELO predictions
      let insertCount = 0;
      
      for (const prediction of filteredPredictions) {
        let tippedTeam = null;
        
        // Handle 50% predictions - default to home team
        if (Math.round(prediction.home_win_probability) === 50) {
          tippedTeam = 'home';
        }
        
        await runQuery(
          'INSERT INTO predictions (match_id, predictor_id, home_win_probability, tipped_team) VALUES (?, ?, ?, ?)',
          [prediction.match_id, predictorId, Math.round(prediction.home_win_probability), tippedTeam]
        );
        
        insertCount++;
      }
      
      logger.info(`Inserted ${insertCount} new ELO predictions`);
    }
    
    // Clean up predictions CSV file (preserve rating history CSV for ELO chart)
    fs.unlinkSync(csvPath);
    
    // Verify that rating history file exists for the ELO chart
    const ratingHistoryPath = path.join(outputDir, `afl_elo_rating_history_from_${currentYear}.csv`);
    if (fs.existsSync(ratingHistoryPath)) {
      logger.info(`ELO rating history preserved at: ${ratingHistoryPath}`);
    } else {
      logger.warn(`ELO rating history file not found at: ${ratingHistoryPath}`);
    }
    
    return {
      success: true,
      message: `ELO predictions updated for ${filteredPredictions.length} matches`
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

/**
 * Parse ELO predictions CSV file
 */
function parsePredictionsCSV(csvPath) {
  return new Promise((resolve, reject) => {
    const predictions = [];
    
    fs.createReadStream(csvPath)
      .pipe(parse({ 
        columns: true, 
        skip_empty_lines: true 
      }))
      .on('data', (row) => {
        predictions.push({
          match_id: parseInt(row.match_id),
          home_win_probability: parseFloat(row.home_win_probability) * 100, // Convert to percentage
          away_win_probability: parseFloat(row.away_win_probability) * 100
        });
      })
      .on('end', () => {
        resolve(predictions);
      })
      .on('error', (error) => {
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