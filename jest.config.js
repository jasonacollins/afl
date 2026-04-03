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
    'public/js/home.js',
    'public/js/main.js',
    'public/js/mobile-nav.js',
    'public/js/predictions.js',
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
      statements: 75,
      branches: 62,
      functions: 76,
      lines: 76
    },
    './public/js/mobile-nav.js': {
      statements: 95,
      branches: 80,
      functions: 100,
      lines: 95
    },
    './public/js/main.js': {
      statements: 58,
      branches: 40,
      functions: 55,
      lines: 60
    },
    './public/js/admin.js': {
      statements: 45,
      branches: 35,
      functions: 35,
      lines: 45
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
    }
  }
};
