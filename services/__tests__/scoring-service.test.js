describe('Scoring Service', () => {
  afterEach(() => {
    delete global.window;
    jest.resetModules();
  });

  test('calculates Brier score from percentage probabilities', () => {
    const scoringService = require('../scoring-service');

    expect(scoringService.calculateBrierScore(70, 1)).toBeCloseTo(0.09);
    expect(scoringService.calculateBrierScore(25, 0)).toBeCloseTo(0.0625);
    expect(scoringService.calculateBrierScore(50, 0.5)).toBeCloseTo(0);
  });

  test('calculates Bits score for home win, away win, and draw outcomes', () => {
    const scoringService = require('../scoring-service');

    expect(scoringService.calculateBitsScore(75, 1)).toBeCloseTo(1 + Math.log2(0.75));
    expect(scoringService.calculateBitsScore(25, 0)).toBeCloseTo(1 + Math.log2(0.75));
    expect(scoringService.calculateBitsScore(50, 0.5)).toBeCloseTo(1);
  });

  test('clamps Bits score probabilities away from zero and one', () => {
    const scoringService = require('../scoring-service');

    expect(scoringService.calculateBitsScore(0, 1)).toBeCloseTo(1 + Math.log2(0.001));
    expect(scoringService.calculateBitsScore(100, 0)).toBeCloseTo(1 + Math.log2(0.001));
  });

  test('awards tip points correctly for 50 percent predictions using tipped team', () => {
    const scoringService = require('../scoring-service');

    expect(scoringService.calculateTipPoints(50, 90, 80, 'home')).toBe(1);
    expect(scoringService.calculateTipPoints(50, 80, 90, 'away')).toBe(1);
    expect(scoringService.calculateTipPoints(50, 80, 90, 'home')).toBe(0);
    expect(scoringService.calculateTipPoints(50, 85, 85, 'home')).toBe(0);
  });

  test('awards tip points correctly for non-50 probabilities', () => {
    const scoringService = require('../scoring-service');

    expect(scoringService.calculateTipPoints(65, 100, 80)).toBe(1);
    expect(scoringService.calculateTipPoints(35, 80, 100)).toBe(1);
    expect(scoringService.calculateTipPoints(65, 80, 100)).toBe(0);
    expect(scoringService.calculateTipPoints(65, 88, 88)).toBe(0);
  });

  test('exports scoring helpers to the browser window when available', () => {
    global.window = {};

    const scoringService = require('../scoring-service');

    expect(window.calculateBrierScore).toBe(scoringService.calculateBrierScore);
    expect(window.calculateBitsScore).toBe(scoringService.calculateBitsScore);
    expect(window.calculateTipPoints).toBe(scoringService.calculateTipPoints);
  });
});
