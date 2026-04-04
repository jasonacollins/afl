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
    'public/js/admin.js',
    'public/js/admin-scripts.js',
    'public/js/elo-chart.js',
    'public/js/home.js',
    'public/js/main.js',
    'public/js/mobile-nav.js',
    'public/js/predictions.js',
    'public/js/simulation.js',
    'public/js/stats.js',
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
      statements: 90,
      branches: 65,
      functions: 90,
      lines: 91
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
      statements: 84,
      branches: 61,
      functions: 100,
      lines: 85
    },
    './routes/simulation.js': {
      statements: 81,
      branches: 80,
      functions: 100,
      lines: 81
    },
    './services/admin-script-runner.js': {
      statements: 87,
      branches: 74,
      functions: 90,
      lines: 87
    },
    './services/featured-predictions.js': {
      statements: 90,
      branches: 85,
      functions: 100,
      lines: 90
    },
    './services/elo-service.js': {
      statements: 82,
      branches: 66,
      functions: 85,
      lines: 83
    },
    './services/event-sync-service.js': {
      statements: 88,
      branches: 78,
      functions: 75,
      lines: 90
    },
    './services/predictor-service.js': {
      statements: 80,
      branches: 84,
      functions: 87,
      lines: 80
    },
    './services/result-update-service.js': {
      statements: 86,
      branches: 68,
      functions: 84,
      lines: 86
    },
    './services/round-service.js': {
      statements: 89,
      branches: 76,
      functions: 95,
      lines: 88
    },
    './models/db.js': {
      statements: 89,
      branches: 67,
      functions: 100,
      lines: 89
    },
    './public/js/admin-scripts.js': {
      statements: 84,
      branches: 70,
      functions: 92,
      lines: 85
    },
    './public/js/mobile-nav.js': {
      statements: 95,
      branches: 80,
      functions: 100,
      lines: 95
    },
    './public/js/main.js': {
      statements: 78,
      branches: 60,
      functions: 71,
      lines: 79
    },
    './public/js/admin.js': {
      statements: 75,
      branches: 52,
      functions: 69,
      lines: 76
    },
    './public/js/elo-chart.js': {
      statements: 76,
      branches: 55,
      functions: 77,
      lines: 77
    },
    './public/js/home.js': {
      statements: 85,
      branches: 75,
      functions: 100,
      lines: 85
    },
    './public/js/predictions.js': {
      statements: 95,
      branches: 90,
      functions: 100,
      lines: 95
    },
    './public/js/simulation.js': {
      statements: 85,
      branches: 66,
      functions: 100,
      lines: 85
    },
    './public/js/stats.js': {
      statements: 81,
      branches: 54,
      functions: 94,
      lines: 81
    },
    './scripts/automation/api-refresh.js': {
      statements: 81,
      branches: 83,
      functions: 58,
      lines: 83
    },
    './scripts/automation/daily-sync.js': {
      statements: 90,
      branches: 75,
      functions: 88,
      lines: 90
    },
    './scripts/automation/db-maintenance.js': {
      statements: 75,
      branches: 65,
      functions: 76,
      lines: 75
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
      statements: 77,
      branches: 72,
      functions: 83,
      lines: 81
    }
  }
};
