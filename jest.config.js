module.exports = {
  openHandlesTimeout: 0,
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 85,
      lines: 85
    }
  },
  testPathIgnorePatterns: [
    '/public/js/__tests__/browser-test-utils.js',
    '/routes/__tests__/test-app.js'
  ]
};
