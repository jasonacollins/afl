const { refreshAPIData } = require('./api-refresh');
const { runEloPredictions } = require('./elo-predictions');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Regenerate ELO historical data with new match results
 */
async function regenerateEloHistory() {
  console.log('Regenerating ELO historical data...');
  
  return new Promise((resolve, reject) => {
    const modelPath = path.join(__dirname, '../data/afl_elo_trained_to_2024.json');
    const dbPath = path.join(__dirname, '../data/afl_predictions.db');
    const outputDir = path.join(__dirname, '../data');
    
    const pythonProcess = spawn('python3', [
      path.join(__dirname, 'afl_elo_history_generator.py'),
      '--model-path', modelPath,
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--output-prefix', 'afl_elo_complete_history'
    ]);
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('ELO History Generator:', data.toString().trim());
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('ELO History Generator Error:', data.toString().trim());
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('ELO historical data regeneration completed successfully');
        resolve({ success: true, message: 'ELO history updated' });
      } else {
        console.error(`ELO history generator failed with code ${code}`);
        console.error('Stderr:', stderr);
        reject(new Error(`ELO history generator failed with code ${code}: ${stderr}`));
      }
    });
    
    pythonProcess.on('error', (error) => {
      console.error('Failed to start ELO history generator:', error);
      reject(error);
    });
  });
}

async function dailySync() {
  console.log(`Running daily sync at ${new Date().toISOString()}`);
  try {
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Step 1: API refresh (default options with forceScoreUpdate = false)
    console.log('Starting API data refresh...');
    const apiResults = await refreshAPIData(currentYear, { forceScoreUpdate: false });
    console.log(`API refresh complete: ${JSON.stringify(apiResults)}`);
    
    // Step 2: ELO predictions (only if API refresh succeeded)
    console.log('Starting ELO predictions...');
    const eloResults = await runEloPredictions();
    console.log(`ELO predictions complete: ${eloResults.message}`);
    
    // Step 3: Regenerate ELO historical data if there were match updates
    const totalUpdates = apiResults.updateCount + apiResults.scoresUpdated;
    if (totalUpdates > 0) {
      console.log(`${totalUpdates} matches were updated (${apiResults.updateCount} fixture updates, ${apiResults.scoresUpdated} score updates), regenerating ELO history...`);
      const historyResults = await regenerateEloHistory();
      console.log(`ELO history regeneration complete: ${historyResults.message}`);
    } else {
      console.log('No matches were updated, skipping ELO history regeneration');
    }
    
    console.log('Daily sync completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Daily sync failed:', error);
    process.exit(1);
  }
}

dailySync();