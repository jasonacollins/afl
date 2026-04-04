module.exports = {
  // Use Node.js test environment
  testEnvironment: 'node',
  
  // Where to output coverage reports
  coverageDirectory: 'coverage',
  
  // Which files to collect coverage from
  collectCoverageFrom: [
    'app.js',
    'services/**/*.js',
    'routes/**/*.js',
    'models/**/*.js',
    'middleware/**/*.js',
    'scripts/automation/**/*.js',
    'utils/**/*.js',
    'public/js/**/*.js',
    '!**/__tests__/**',
    '!**/node_modules/**'
  ],
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // No transform needed for Node.js files
  transform: {},

  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 87,
      lines: 86
    },
    './app.js': {
      statements: 93,
      branches: 75,
      functions: 90,
      lines: 93
    },
    './routes/admin.js': {
      statements: 90,
      branches: 71,
      functions: 95,
      lines: 90
    },
    './routes/auth.js': {
      statements: 91,
      branches: 76,
      functions: 100,
      lines: 91
    },
    './routes/elo.js': {
      statements: 90,
      branches: 90,
      functions: 100,
      lines: 90
    },
    './routes/matches.js': {
      statements: 98,
      branches: 74,
      functions: 92,
      lines: 99
    },
    './routes/predictions.js': {
      statements: 94,
      branches: 85,
      functions: 100,
      lines: 95
    },
    './routes/simulation.js': {
      statements: 91,
      branches: 82,
      functions: 100,
      lines: 91
    },
    './services/admin-script-runner.js': {
      statements: 88,
      branches: 76,
      functions: 92,
      lines: 87
    },
    './services/admin-script-definitions.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    './services/featured-predictions.js': {
      statements: 94,
      branches: 92,
      functions: 100,
      lines: 94
    },
    './services/elo-service.js': {
      statements: 88,
      branches: 75,
      functions: 90,
      lines: 88
    },
    './services/event-sync-service.js': {
      statements: 90,
      branches: 79,
      functions: 80,
      lines: 92
    },
    './services/predictor-service.js': {
      statements: 95,
      branches: 90,
      functions: 100,
      lines: 95
    },
    './services/result-update-service.js': {
      statements: 90,
      branches: 70,
      functions: 85,
      lines: 90
    },
    './services/match-service.js': {
      statements: 84,
      branches: 77,
      functions: 100,
      lines: 83
    },
    './services/password-service.js': {
      statements: 100,
      branches: 85,
      functions: 100,
      lines: 100
    },
    './services/prediction-service.js': {
      statements: 91,
      branches: 97,
      functions: 100,
      lines: 91
    },
    './services/scoring-service.js': {
      statements: 100,
      branches: 95,
      functions: 100,
      lines: 100
    },
    './services/round-service.js': {
      statements: 89,
      branches: 76,
      functions: 95,
      lines: 88
    },
    './models/db.js': {
      statements: 93,
      branches: 72,
      functions: 100,
      lines: 93
    },
    './middleware/csrf.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    './public/js/admin-scripts.js': {
      statements: 88,
      branches: 70,
      functions: 92,
      lines: 90
    },
    './public/js/mobile-nav.js': {
      statements: 95,
      branches: 80,
      functions: 100,
      lines: 95
    },
    './public/js/main.js': {
      statements: 84,
      branches: 68,
      functions: 80,
      lines: 84
    },
    './public/js/admin.js': {
      statements: 84,
      branches: 62,
      functions: 85,
      lines: 84
    },
    './public/js/elo-chart.js': {
      statements: 85,
      branches: 69,
      functions: 88,
      lines: 86
    },
    './public/js/home.js': {
      statements: 92,
      branches: 87,
      functions: 100,
      lines: 92
    },
    './public/js/predictions.js': {
      statements: 95,
      branches: 90,
      functions: 100,
      lines: 95
    },
    './public/js/simulation.js': {
      statements: 90,
      branches: 75,
      functions: 100,
      lines: 90
    },
    './public/js/stats.js': {
      statements: 90,
      branches: 65,
      functions: 100,
      lines: 90
    },
    './utils/error-handler.js': {
      statements: 93,
      branches: 72,
      functions: 85,
      lines: 93
    },
    './utils/logger.js': {
      statements: 92,
      branches: 66,
      functions: 64,
      lines: 92
    },
    './utils/squiggle-request.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    './scripts/automation/api-refresh.js': {
      statements: 84,
      branches: 85,
      functions: 58,
      lines: 87
    },
    './scripts/automation/daily-sync.js': {
      statements: 90,
      branches: 75,
      functions: 88,
      lines: 90
    },
    './scripts/automation/db-maintenance.js': {
      statements: 89,
      branches: 77,
      functions: 85,
      lines: 89
    },
    './scripts/automation/elo-predictions.js': {
      statements: 85,
      branches: 75,
      functions: 66,
      lines: 85
    },
    './scripts/automation/import-data.js': {
      statements: 93,
      branches: 50,
      functions: 100,
      lines: 93
    },
    './scripts/automation/sync-games.js': {
      statements: 84,
      branches: 78,
      functions: 88,
      lines: 88
    }
  }
};
