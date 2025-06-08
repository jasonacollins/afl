const { refreshAPIData } = require('./api-refresh');
const { runEloPredictions } = require('./elo-predictions');

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
    
    console.log('Daily sync completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Daily sync failed:', error);
    process.exit(1);
  }
}

dailySync();