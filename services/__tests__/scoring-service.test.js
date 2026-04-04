const path = require('path');
const { execFileSync } = require('child_process');

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

  test('matches the Python scoring helpers for shared Brier and Bits formulas', () => {
    const scoringService = require('../scoring-service');
    const repoRoot = path.resolve(__dirname, '..', '..');
    const cases = [
      { probability: 0, outcome: 1 },
      { probability: 25, outcome: 0 },
      { probability: 50, outcome: 0.5 },
      { probability: 70, outcome: 1 },
      { probability: 100, outcome: 0 }
    ];

    const jsResults = cases.map(({ probability, outcome }) => ({
      brier: scoringService.calculateBrierScore(probability, outcome),
      bits: scoringService.calculateBitsScore(probability, outcome)
    }));

    const pythonResults = JSON.parse(execFileSync(
      'python3',
      [
        '-c',
        [
          'import json',
          'import sys',
          'from pathlib import Path',
          'repo_root = Path.cwd()',
          "sys.path.insert(0, str(repo_root / 'scripts'))",
          'from core import scoring',
          'cases = json.loads(sys.argv[1])',
          'results = []',
          'for case in cases:',
          "    results.append({",
          "        'brier': scoring.calculate_brier_score(case['probability'], case['outcome']),",
          "        'bits': scoring.calculate_bits_score(case['probability'], case['outcome']),",
          '    })',
          'print(json.dumps(results))'
        ].join('\n'),
        JSON.stringify(cases)
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8'
      }
    ));

    expect(pythonResults).toHaveLength(jsResults.length);
    pythonResults.forEach((pythonResult, index) => {
      expect(pythonResult.brier).toBeCloseTo(jsResults[index].brier, 10);
      expect(pythonResult.bits).toBeCloseTo(jsResults[index].bits, 10);
    });
  });
});
