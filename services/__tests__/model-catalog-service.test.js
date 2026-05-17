jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn()
  }
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  }
}));

const fs = require('fs').promises;
const modelCatalogService = require('../model-catalog-service');

function makeStat(size = 100) {
  return {
    size,
    mtime: new Date('2026-04-01T00:00:00.000Z')
  };
}

describe('model-catalog-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.stat.mockResolvedValue(makeStat());
  });

  test('catalogues model artifacts with readable labels and typed kinds', async () => {
    fs.readFile.mockImplementation((absolutePath) => {
      const filePath = String(absolutePath);
      if (filePath.endsWith('afl_elo_win_trained_to_2025.json')) {
        return Promise.resolve(JSON.stringify({
          model_type: 'win_elo',
          team_ratings: { Sydney: 1600 },
          performance_metrics: { brier_score: 0.2027, accuracy: 0.68 }
        }));
      }
      if (filePath.endsWith('optimal_margin_only_elo_params_trained_to_2025.json')) {
        return Promise.resolve(JSON.stringify({
          model_type: 'margin_only_elo',
          mae: 29.65,
          optimization_details: { start_year: 1990, end_year: 2025 }
        }));
      }
      if (filePath.endsWith('optimal_margin_methods_trained_to_2025.json')) {
        return Promise.resolve(JSON.stringify({
          artifact_type: 'win_margin_methods',
          train_window: { start_year: 1990, end_year: 2025 },
          best_score: 31.76,
          required_win_model: { train_end_year: 2025 }
        }));
      }
      return Promise.reject(new Error('not found'));
    });

    const catalog = await modelCatalogService.getModelCatalog({
      modelFiles: {
        win: [
          'data/models/win/afl_elo_win_trained_to_2025.json',
          'data/models/win/optimal_margin_methods_trained_to_2025.json'
        ],
        margin: [
          'data/models/margin/optimal_margin_only_elo_params_trained_to_2025.json'
        ]
      }
    });

    expect(catalog.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'data/models/win/afl_elo_win_trained_to_2025.json',
        kind: 'trained_win_model',
        kindLabel: 'Win model',
        trainedThroughYear: 2025,
        label: expect.stringContaining('Brier 0.2027')
      }),
      expect.objectContaining({
        path: 'data/models/margin/optimal_margin_only_elo_params_trained_to_2025.json',
        kind: 'margin_params',
        kindLabel: 'Margin params',
        label: expect.stringContaining('MAE 29.65')
      }),
      expect.objectContaining({
        path: 'data/models/win/optimal_margin_methods_trained_to_2025.json',
        kind: 'win_margin_methods',
        compatibility: expect.objectContaining({
          requiredWinModelTrainEndYear: 2025
        })
      })
    ]));
    expect(catalog.byKind.trained_win_model).toHaveLength(1);
    expect(catalog.byKind.margin_params).toHaveLength(1);
  });

  test('catalogues generated outputs with row counts and simulation metadata', async () => {
    fs.readdir.mockImplementation((absolutePath) => {
      const directory = String(absolutePath);
      if (directory.endsWith('data/predictions/margin')) {
        return Promise.resolve([
          { name: 'margin_elo_predictions_2026_2026.csv', isFile: () => true }
        ]);
      }
      if (directory.endsWith('data/simulations')) {
        return Promise.resolve([
          { name: 'season_simulation_2026.json', isFile: () => true }
        ]);
      }
      return Promise.resolve([]);
    });

    fs.readFile.mockImplementation((absolutePath) => {
      const filePath = String(absolutePath);
      if (filePath.endsWith('margin_elo_predictions_2026_2026.csv')) {
        return Promise.resolve('match_id,home_team\n1,Sydney\n2,Geelong\n');
      }
      if (filePath.endsWith('season_simulation_2026.json')) {
        return Promise.resolve(JSON.stringify({
          year: 2026,
          model_mode: 'margin_only',
          margin_model_path: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json'
        }));
      }
      return Promise.reject(new Error('not found'));
    });

    const catalog = await modelCatalogService.getOutputCatalog();

    expect(catalog.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'data/predictions/margin/margin_elo_predictions_2026_2026.csv',
        kind: 'margin_predictions',
        rowCount: 2,
        label: expect.stringContaining('2 rows')
      }),
      expect.objectContaining({
        path: 'data/simulations/season_simulation_2026.json',
        kind: 'season_simulation',
        modelMode: 'margin_only',
        inputModels: expect.objectContaining({
          marginModelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json'
        })
      })
    ]));
  });
});
