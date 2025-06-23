module.exports = {
  // Use Node.js test environment
  testEnvironment: 'node',
  
  // Where to output coverage reports
  coverageDirectory: 'coverage',
  
  // Which files to collect coverage from
  collectCoverageFrom: [
    'services/**/*.js',
    'routes/**/*.js',
    'models/**/*.js',
    '!**/node_modules/**'
  ],
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // No transform needed for Node.js files
  transform: {}
};