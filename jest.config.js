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
      statements: 76,
      branches: 62,
      functions: 78,
      lines: 77
    },
    './app.js': {
      statements: 88,
      branches: 64,
      functions: 82,
      lines: 89
    },
    './services/elo-service.js': {
      statements: 69,
      branches: 58,
      functions: 71,
      lines: 70
    },
    './public/js/mobile-nav.js': {
      statements: 95,
      branches: 80,
      functions: 100,
      lines: 95
    },
    './public/js/main.js': {
      statements: 73,
      branches: 57,
      functions: 69,
      lines: 75
    },
    './public/js/admin.js': {
      statements: 70,
      branches: 50,
      functions: 60,
      lines: 70
    },
    './public/js/elo-chart.js': {
      statements: 62,
      branches: 43,
      functions: 67,
      lines: 62
    },
    './public/js/home.js': {
      statements: 70,
      branches: 55,
      functions: 100,
      lines: 70
    },
    './public/js/predictions.js': {
      statements: 85,
      branches: 50,
      functions: 100,
      lines: 85
    },
    './public/js/stats.js': {
      statements: 80,
      branches: 50,
      functions: 90,
      lines: 80
    },
    './scripts/automation/api-refresh.js': {
      statements: 81,
      branches: 83,
      functions: 58,
      lines: 83
    },
    './scripts/automation/daily-sync.js': {
      statements: 78,
      branches: 62,
      functions: 75,
      lines: 78
    },
    './scripts/automation/sync-games.js': {
      statements: 77,
      branches: 72,
      functions: 83,
      lines: 81
    }
  }
};
