// Import the scoring service functions
const scoringService = require('../scoring-service');

// Basic test structure to verify setup works
describe('Scoring Service', () => {
  test('module exports required functions', () => {
    expect(typeof scoringService.calculateBrierScore).toBe('function');
    expect(typeof scoringService.calculateBitsScore).toBe('function');
    expect(typeof scoringService.calculateTipPoints).toBe('function');
  });
});