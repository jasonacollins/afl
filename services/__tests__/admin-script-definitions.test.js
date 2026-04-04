const {
  ALLOWED_PATH_BASES,
  YEAR_MIN,
  getYearMax,
  getScriptDefinition,
  getScriptCatalog
} = require('../admin-script-definitions');

describe('Admin Script Definitions', () => {
  test('exports the approved data path bases used by the script runner', () => {
    expect(ALLOWED_PATH_BASES).toEqual([
      'data/models',
      'data/database',
      'data/predictions',
      'data/historical',
      'data/simulations'
    ]);
  });

  test('returns null for unknown script definitions', () => {
    expect(getScriptDefinition('does-not-exist')).toBeNull();
  });

  test('includes win-margin-methods-optimize script definition', () => {
    const definition = getScriptDefinition('win-margin-methods-optimize');

    expect(definition).toBeTruthy();
    expect(definition.label).toBe('Optimise Win Margin Methods (Testing)');

    const fieldNames = definition.fields.map((field) => field.name);
    expect(fieldNames).toEqual(expect.arrayContaining([
      'eloParamsPath',
      'startYear',
      'endYear',
      'nCalls',
      'randomSeed',
      'dbPath',
      'outputPath'
    ]));

    const modelField = definition.fields.find((field) => field.name === 'eloParamsPath');
    expect(modelField.optionSource).toBe('modelFiles.winModelOrParams');
  });

  test('includes win-margin-methods-predictions script definition', () => {
    const definition = getScriptDefinition('win-margin-methods-predictions');

    expect(definition).toBeTruthy();
    expect(definition.label).toBe('Win + Optimised Margin');

    const fieldNames = definition.fields.map((field) => field.name);
    expect(fieldNames).toEqual(expect.arrayContaining([
      'startYear',
      'winModelPath',
      'marginMethodsPath',
      'predictorId',
      'dbPath',
      'outputDir',
      'saveToDb',
      'futureOnly',
      'overrideCompleted',
      'methodOverride'
    ]));

    const winModelField = definition.fields.find((field) => field.name === 'winModelPath');
    const marginMethodsField = definition.fields.find((field) => field.name === 'marginMethodsPath');
    expect(winModelField.optionSource).toBe('modelFiles.winModels');
    expect(marginMethodsField.optionSource).toBe('modelFiles.winMarginMethods');
  });

  test('catalog resolves dynamic year max for new script', () => {
    const catalog = getScriptCatalog();
    const definition = catalog.find((item) => item.key === 'win-margin-methods-predictions');

    expect(definition).toBeTruthy();

    const startYearField = definition.fields.find((field) => field.name === 'startYear');
    expect(startYearField).toBeTruthy();
    expect(startYearField.max).toBeGreaterThanOrEqual(new Date().getFullYear());
  });

  test('catalog resolves dynamic year max for win-margin-methods-optimize', () => {
    const catalog = getScriptCatalog();
    const definition = catalog.find((item) => item.key === 'win-margin-methods-optimize');

    expect(definition).toBeTruthy();

    const endYearField = definition.fields.find((field) => field.name === 'endYear');
    expect(endYearField).toBeTruthy();
    expect(endYearField.max).toBeGreaterThanOrEqual(new Date().getFullYear());
  });

  test('catalog field metadata stays internally consistent for every script', () => {
    const catalog = getScriptCatalog();
    const allowedOptionSources = new Set([
      'activePredictors',
      'modelFiles.history',
      'modelFiles.margin',
      'modelFiles.winMarginMethods',
      'modelFiles.winModelOrParams',
      'modelFiles.winModels',
      'modelFiles.winParams'
    ]);
    const pathFieldNames = new Set([
      'dbPath',
      'eloParamsPath',
      'marginMethodsPath',
      'marginModelPath',
      'marginParams',
      'modelPath',
      'output',
      'outputDir',
      'outputPath',
      'paramsFile',
      'winModelPath'
    ]);

    expect(catalog.length).toBeGreaterThan(0);

    catalog.forEach((definition) => {
      expect(definition.key).toBeTruthy();
      expect(definition.label).toBeTruthy();
      expect(definition.description).toBeTruthy();

      const fieldNames = definition.fields.map((field) => field.name);
      expect(new Set(fieldNames).size).toBe(fieldNames.length);

      definition.fields.forEach((field) => {
        expect(field.label).toBeTruthy();
        expect(field.type).toBeTruthy();

        if (field.optionSource) {
          expect(field.type).toBe('select');
          expect(allowedOptionSources.has(field.optionSource)).toBe(true);
        }

        if (field.maxDynamic === 'yearMax') {
          expect(field.max).toBe(getYearMax());
          expect(field.min).toBe(YEAR_MIN);
        }

        if (pathFieldNames.has(field.name)) {
          expect(['select', 'text']).toContain(field.type);
        }
      });
    });
  });

  test('prediction-writing jobs require an active predictor selection', () => {
    ['combined-predictions', 'margin-predictions', 'win-margin-methods-predictions'].forEach((key) => {
      const definition = getScriptDefinition(key);
      const predictorField = definition.fields.find((field) => field.name === 'predictorId');

      expect(predictorField).toEqual(expect.objectContaining({
        type: 'select',
        required: true,
        optionSource: 'activePredictors'
      }));
    });
  });
});
