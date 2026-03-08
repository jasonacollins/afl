const {
  getScriptDefinition,
  getScriptCatalog
} = require('../admin-script-definitions');

describe('Admin Script Definitions', () => {
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
});
