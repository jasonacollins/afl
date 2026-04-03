const { initializeDatabase } = require('../../models/db');
const { syncTeams } = require('./sync-games');
const { logger } = require('../../utils/logger');

async function importData() {
  try {
    logger.info('Initializing database...');
    await initializeDatabase();
    
    logger.info('Importing teams...');
    await syncTeams();
    
    logger.info('Data import complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error importing data', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  importData();
}

module.exports = {
  importData
};
