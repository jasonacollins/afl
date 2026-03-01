const YEAR_MIN = 1990;

function getYearMax() {
  return new Date().getFullYear() + 2;
}

const ALLOWED_PATH_BASES = [
  'data/models',
  'data/database',
  'data/predictions',
  'data/historical',
  'data/simulations'
];

const SCRIPT_DEFINITIONS = {
  'sync-games': {
    key: 'sync-games',
    label: 'Sync Games',
    description: 'Sync fixtures and match metadata from Squiggle API.',
    fields: [
      { name: 'year', label: 'Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'round', label: 'Round', type: 'text', required: false },
      { name: 'gameId', label: 'Game ID', type: 'number', required: false },
      { name: 'teamId', label: 'Team ID', type: 'number', required: false },
      { name: 'complete', label: 'Complete %', type: 'number', required: false, min: 0, max: 100 }
    ]
  },
  'api-refresh': {
    key: 'api-refresh',
    label: 'API Refresh',
    description: 'Refresh fixture and scoring updates for a single season.',
    fields: [
      { name: 'year', label: 'Year', type: 'number', required: true, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'forceScoreUpdate', label: 'Force Score Update', type: 'boolean', required: false }
    ]
  },
  'combined-predictions': {
    key: 'combined-predictions',
    label: 'Predictions',
    description: 'Run win + margin ELO predictions and write to database.',
    fields: [
      { name: 'startYear', label: 'Start Year', type: 'number', required: true, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'winModelPath', label: 'Win Model', type: 'select', required: true, optionSource: 'modelFiles.win' },
      { name: 'marginModelPath', label: 'Margin Model', type: 'select', required: true, optionSource: 'modelFiles.margin' },
      { name: 'predictorId', label: 'Predictor', type: 'select', required: true, optionSource: 'activePredictors' },
      { name: 'futureOnly', label: 'Future Games Only', type: 'boolean', required: false },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'outputDir', label: 'Output Directory', type: 'text', required: false },
      { name: 'saveToDb', label: 'Save to DB', type: 'boolean', required: false }
    ]
  },
  'margin-predictions': {
    key: 'margin-predictions',
    label: 'Margin Predictions',
    description: 'Run margin-only ELO predictions and derive win probabilities.',
    fields: [
      { name: 'startYear', label: 'Start Year', type: 'number', required: true, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'modelPath', label: 'Margin Model', type: 'select', required: true, optionSource: 'modelFiles.margin' },
      { name: 'predictorId', label: 'Predictor', type: 'select', required: true, optionSource: 'activePredictors' },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'outputDir', label: 'Output Directory', type: 'text', required: false },
      { name: 'saveToDb', label: 'Save to DB', type: 'boolean', required: false },
      { name: 'overrideCompleted', label: 'Override Completed', type: 'boolean', required: false }
    ]
  },
  'win-train': {
    key: 'win-train',
    label: 'Train Win Model',
    description: 'Train the standard win ELO model.',
    fields: [
      { name: 'startYear', label: 'Start Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'endYear', label: 'End Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'outputDir', label: 'Output Directory', type: 'text', required: false },
      { name: 'noTuneParameters', label: 'Skip Parameter Tuning', type: 'boolean', required: false },
      { name: 'cvFolds', label: 'CV Folds', type: 'number', required: false, min: 2, max: 10 },
      { name: 'maxCombinations', label: 'Max Combinations', type: 'number', required: false, min: 1, max: 5000 },
      { name: 'paramsFile', label: 'Params File', type: 'select', required: false, optionSource: 'modelFiles.win' },
      { name: 'marginParams', label: 'Margin Params File', type: 'select', required: false, optionSource: 'modelFiles.win' }
    ]
  },
  'margin-optimize': {
    key: 'margin-optimize',
    label: 'Optimise Margin Params',
    description: 'Optimise margin-only ELO parameters.',
    fields: [
      { name: 'startYear', label: 'Start Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'endYear', label: 'End Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'maxCombinations', label: 'Max Combinations', type: 'number', required: false, min: 1, max: 5000 },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'outputPath', label: 'Output Path', type: 'text', required: false }
    ]
  },
  'margin-train': {
    key: 'margin-train',
    label: 'Train Margin Model',
    description: 'Train the margin-only ELO model.',
    fields: [
      { name: 'paramsFile', label: 'Params File', type: 'select', required: true, optionSource: 'modelFiles.margin' },
      { name: 'startYear', label: 'Start Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'endYear', label: 'End Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'outputDir', label: 'Output Directory', type: 'text', required: false }
    ]
  },
  'elo-history': {
    key: 'elo-history',
    label: 'ELO History Generator',
    description: 'Regenerate historical ELO CSV for charting.',
    fields: [
      { name: 'modelPath', label: 'Model Path', type: 'select', required: true, optionSource: 'modelFiles.history' },
      { name: 'mode', label: 'Mode', type: 'text', required: false },
      { name: 'seedStartYear', label: 'Seed Start Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'seedEndYear', label: 'Seed End Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'outputStartYear', label: 'Output Start Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'outputEndYear', label: 'Output End Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'startYear', label: 'Legacy Start Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'endYear', label: 'Legacy End Year', type: 'number', required: false, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'outputDir', label: 'Output Directory', type: 'text', required: false },
      { name: 'outputPrefix', label: 'Output Prefix', type: 'text', required: false }
    ]
  },
  'season-simulation': {
    key: 'season-simulation',
    label: 'Season Simulation',
    description: 'Run Monte Carlo season simulation and write JSON output.',
    fields: [
      { name: 'year', label: 'Year', type: 'number', required: true, min: YEAR_MIN, maxDynamic: 'yearMax' },
      { name: 'modelPath', label: 'Margin Model', type: 'select', required: true, optionSource: 'modelFiles.margin' },
      { name: 'winModelPath', label: 'Win Model (Combined Mode)', type: 'select', required: false, optionSource: 'modelFiles.win' },
      { name: 'dbPath', label: 'DB Path', type: 'text', required: false },
      { name: 'numSimulations', label: 'Simulations', type: 'number', required: false, min: 1000, max: 200000 },
      { name: 'fromScratch', label: 'From Scratch', type: 'boolean', required: false },
      { name: 'backfillRoundSnapshots', label: 'Backfill Round Snapshots', type: 'boolean', required: false },
      { name: 'output', label: 'Output File', type: 'text', required: false }
    ]
  }
};

function getScriptDefinition(scriptKey) {
  return SCRIPT_DEFINITIONS[scriptKey] || null;
}

function getScriptCatalog() {
  const yearMax = getYearMax();

  return Object.values(SCRIPT_DEFINITIONS).map((definition) => ({
    ...definition,
    fields: definition.fields.map((field) => {
      if (field.maxDynamic === 'yearMax') {
        return { ...field, max: yearMax };
      }
      return { ...field };
    })
  }));
}

module.exports = {
  YEAR_MIN,
  getYearMax,
  ALLOWED_PATH_BASES,
  getScriptDefinition,
  getScriptCatalog
};
