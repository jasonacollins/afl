const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

function buildAdminScriptsDom() {
  return `
    <meta name="csrf-token" content="scripts-csrf-token">
    <div id="scriptsPageError" style="display:none"></div>
    <div id="activeRunBanner" style="display:none"></div>
    <div id="logRunLabel"></div>
    <pre id="scriptLogsOutput">No logs loaded.</pre>
    <table><tbody id="scriptRunHistoryBody"></tbody></table>

    <div data-predictions-mode-panel="optimized" id="optimizedPanel"></div>
    <div data-predictions-mode-panel="margin" id="marginPanel"></div>

    <select id="trainOptimizationTarget">
      <option value="win" selected>Win</option>
      <option value="margin">Margin</option>
    </select>
    <div data-train-mode-panel="win" id="trainWinPanel"></div>
    <div data-train-mode-panel="margin" id="trainMarginPanel"></div>

    <form class="script-run-form" data-script-key="combined-predictions">
      <select id="predictionsMode" name="predictionMode">
        <option value="optimized" selected>Optimized</option>
        <option value="margin">Margin</option>
      </select>
      <input id="syncYear" name="syncYear" value="">
      <input id="apiRefreshYear" name="apiRefreshYear" value="">
      <input id="combinedStartYear" name="combinedStartYear" value="">
      <input id="winTrainStartYear" name="winTrainStartYear" value="">
      <input id="winTrainEndYear" name="winTrainEndYear" value="">
      <input id="marginOptimizeStartYear" name="marginOptimizeStartYear" value="">
      <input id="marginOptimizeEndYear" name="marginOptimizeEndYear" value="">
      <input id="winMarginMethodsOptimizeStartYear" name="winMarginMethodsOptimizeStartYear" value="">
      <input id="winMarginMethodsOptimizeEndYear" name="winMarginMethodsOptimizeEndYear" value="">
      <input id="marginTrainStartYear" name="marginTrainStartYear" value="">
      <input id="marginTrainEndYear" name="marginTrainEndYear" value="">
      <input id="historySeedStartYear" name="historySeedStartYear" value="">
      <input id="historySeedEndYear" name="historySeedEndYear" value="">
      <input id="historyOutputStartYear" name="historyOutputStartYear" value="">
      <input id="historyOutputEndYear" name="historyOutputEndYear" value="">
      <input id="simYear" name="simYear" value="">

      <input id="combinedDbPath" name="dbPath" value="">
      <input id="optimizedDbPath" name="optimizedDbPath" value="">
      <input id="combinedOutputDir" name="outputDir" value="">
      <input id="optimizedOutputDir" name="optimizedOutputDir" value="">
      <input id="historyDbPath" name="historyDbPath" value="">
      <input id="historyOutputDir" name="historyOutputDir" value="">
      <input id="historyOutputPrefix" name="historyOutputPrefix" value="">
      <select id="historyMode" name="historyMode">
        <option value=""></option>
        <option value="incremental">Incremental</option>
      </select>
      <input id="simDbPath" name="simDbPath" value="">
      <input id="winTrainDbPath" name="winTrainDbPath" value="">
      <input id="marginTrainDbPath" name="marginTrainDbPath" value="">
      <input id="marginOptimizeDbPath" name="marginOptimizeDbPath" value="">
      <input id="winMarginMethodsOptimizeDbPath" name="winMarginMethodsOptimizeDbPath" value="">
      <input id="winTrainOutputDir" name="winTrainOutputDir" value="">
      <input id="marginTrainOutputDir" name="marginTrainOutputDir" value="">
      <input id="marginOptimizeOutputPath" name="marginOptimizeOutputPath" value="">
      <input id="winMarginMethodsOptimizeOutputPath" name="winMarginMethodsOptimizeOutputPath" value="">
      <input id="simNumSimulations" name="simNumSimulations" value="">
      <input id="winTrainCvFolds" name="winTrainCvFolds" value="">
      <input id="winTrainMaxCombinations" name="winTrainMaxCombinations" value="">
      <input id="marginOptimizeMaxCombinations" name="marginOptimizeMaxCombinations" value="">
      <input id="winMarginMethodsOptimizeNCalls" name="winMarginMethodsOptimizeNCalls" value="">
      <input id="winMarginMethodsOptimizeRandomSeed" name="winMarginMethodsOptimizeRandomSeed" value="">

      <select id="optimizedWinModelPath" name="optimizedWinModelPath"></select>
      <select id="optimizedMarginMethodsPath" name="optimizedMarginMethodsPath"></select>
      <select id="historyModelPath" name="historyModelPath"></select>
      <select id="combinedMarginModelPath" name="marginModelPath"></select>
      <select id="winTrainParamsFile" name="winTrainParamsFile"></select>
      <select id="winTrainMarginParams" name="winTrainMarginParams"></select>
      <select id="marginTrainParamsFile" name="marginTrainParamsFile"></select>
      <select id="winMarginMethodsOptimizeEloParamsPath" name="winMarginMethodsOptimizeEloParamsPath"></select>
      <select id="combinedPredictorId" name="combinedPredictorId"></select>
      <select id="optimizedPredictorId" name="optimizedPredictorId"></select>

      <input type="checkbox" id="optimizedFutureOnly" name="optimizedFutureOnly" checked>
      <input type="checkbox" id="optimizedOverrideCompleted" name="optimizedOverrideCompleted">
      <input type="checkbox" id="optimizedSaveToDb" name="optimizedSaveToDb" checked>
      <input id="optimizedMethodOverride" name="optimizedMethodOverride" value="">
      <input type="checkbox" id="optimizedAllowModelMismatch" name="optimizedAllowModelMismatch">

      <button type="submit">Run Predictions</button>
    </form>
  `;
}

function buildMetadataResponse() {
  return {
    success: true,
    defaults: {
      currentYear: 2026,
      yearMax: 2026,
      dbPath: 'data/database/afl_predictions.db',
      marginPredictionsOutputDir: 'data/predictions/margin',
      winMarginMethodsOutputDir: 'data/predictions/win',
      historicalOutputDir: 'data/historical',
      historicalOutputPrefix: 'afl_elo_complete_history',
      historicalMode: 'incremental',
      historicalSeedStartYear: 1990,
      historicalOutputStartYear: 2000,
      predictorId: 6,
      marginPredictorId: 6,
      winMarginMethodsPredictorId: 7
    },
    modelFiles: {
      win: [
        'data/models/win/afl_elo_win_trained_to_2024.json',
        'data/models/win/afl_elo_win_trained_to_2025.json',
        'data/models/win/optimal_elo_params_win_trained_to_2025.json',
        'data/models/win/optimal_margin_methods_trained_to_2025.json'
      ],
      margin: [
        'data/models/margin/afl_elo_margin_only_trained_to_2024.json',
        'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
        'data/models/margin/optimal_margin_only_elo_params_trained_to_2025.json'
      ],
      history: [
        'data/models/margin/afl_elo_margin_only_trained_to_2025.json'
      ],
      winMarginMethods: [
        'data/models/win/optimal_margin_methods_trained_to_2025.json'
      ]
    },
    activePredictors: [
      { predictor_id: 6, display_name: "Dad's AI" },
      { predictor_id: 7, display_name: 'Optimized AI' }
    ]
  };
}

function makeWritableSelectValue(element, initialValue = '') {
  let currentValue = initialValue;
  Object.defineProperty(element, 'value', {
    get() {
      return currentValue;
    },
    set(nextValue) {
      currentValue = String(nextValue);
    },
    configurable: true
  });
}

function getRefreshLoopCallback() {
  const intervalCall = global.setInterval.mock.calls[0];
  return intervalCall ? intervalCall[0] : null;
}

describe('public/js/admin-scripts.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalFetch;
  let originalSetInterval;
  let originalClearInterval;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(buildAdminScriptsDom(), { url: 'https://example.test/admin/scripts' });
    restoreDomGlobals = installDomGlobals(dom);
    makeWritableSelectValue(dom.window.document.getElementById('predictionsMode'), 'optimized');
    makeWritableSelectValue(dom.window.document.getElementById('trainOptimizationTarget'), 'win');

    originalFetch = global.fetch;
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;

    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.setInterval = jest.fn(() => 123);
    window.setInterval = global.setInterval;
    global.clearInterval = jest.fn();
    window.clearInterval = global.clearInterval;
  });

  afterEach(() => {
    if (typeof originalFetch === 'undefined') {
      delete global.fetch;
      delete window.fetch;
    } else {
      global.fetch = originalFetch;
      window.fetch = originalFetch;
    }

    global.setInterval = originalSetInterval;
    window.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    window.clearInterval = originalClearInterval;

    restoreDomGlobals();
    dom.window.close();
  });

  test('initializes metadata defaults, auto-managed output paths, and active run state', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => buildMetadataResponse()
        });
      }

      if (url === '/admin/api/script-runs?limit=30') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: [
              {
                run_id: 18,
                script_key: 'margin-predictions',
                status: 'running',
                created_at: '2026-04-03T09:00:00.000Z',
                started_at: '2026-04-03T09:00:05.000Z',
                created_by_name: 'Admin'
              }
            ]
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('apiRefreshYear').value).toBe('2026');
    expect(document.getElementById('marginTrainEndYear').value).toBe('2025');
    expect(document.getElementById('combinedDbPath').value).toBe('data/database/afl_predictions.db');
    expect(document.getElementById('optimizedWinModelPath').value)
      .toBe('data/models/win/afl_elo_win_trained_to_2025.json');
    expect(document.getElementById('combinedMarginModelPath').value)
      .toBe('data/models/margin/afl_elo_margin_only_trained_to_2025.json');
    expect(document.getElementById('combinedPredictorId').value).toBe('6');
    expect(document.getElementById('optimizedPredictorId').value).toBe('7');
    expect(document.getElementById('activeRunBanner').textContent).toContain('Run #18');
    expect(document.querySelector('.script-run-form button[type="submit"]').disabled).toBe(true);
    expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);

    const endYearInput = document.getElementById('marginOptimizeEndYear');
    endYearInput.value = '2024';
    endYearInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(document.getElementById('marginOptimizeOutputPath').value)
      .toBe('data/models/margin/optimal_margin_only_elo_params_trained_to_2024.json');

    document.getElementById('predictionsMode').value = 'margin';
    document.getElementById('predictionsMode').dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(document.getElementById('optimizedWinModelPath').required).toBe(false);
    expect(document.getElementById('combinedMarginModelPath').required).toBe(true);
  });

  test('submits margin prediction runs with transformed params and starts log polling state', async () => {
    global.fetch.mockImplementation((url, options) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => buildMetadataResponse()
        });
      }

      if (url === '/admin/api/script-runs?limit=30' && !options) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: []
          })
        });
      }

      if (url === '/admin/api/script-runs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            run: {
              runId: 33,
              status: 'queued'
            }
          })
        });
      }

      if (url === '/admin/api/script-runs/33/logs?afterSeq=0&limit=500') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            logs: [
              {
                created_at: '2026-04-03T10:00:00.000Z',
                stream: 'stdout',
                message: 'Predictions started'
              }
            ],
            lastSeq: 1
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    const modeSelect = document.getElementById('predictionsMode');
    modeSelect.value = 'margin';
    modeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    document.getElementById('combinedStartYear').value = '2026';
    document.getElementById('combinedMarginModelPath').value =
      'data/models/margin/afl_elo_margin_only_trained_to_2025.json';
    document.getElementById('combinedPredictorId').value = '6';
    document.getElementById('combinedDbPath').value = 'data/database/afl_predictions.db';
    document.getElementById('combinedOutputDir').value = 'data/predictions/margin';

    document.querySelector('.script-run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const postCall = global.fetch.mock.calls.find(([url]) => url === '/admin/api/script-runs');
    expect(postCall).toBeDefined();
    expect(postCall[1].headers['X-CSRF-Token']).toBe('scripts-csrf-token');

    const payload = JSON.parse(postCall[1].body);
    expect(payload.scriptKey).toBe('margin-predictions');
    expect(payload.params).toEqual(expect.objectContaining({
      combinedStartYear: '2026',
      modelPath: 'data/models/margin/afl_elo_margin_only_trained_to_2025.json',
      combinedPredictorId: '6',
      dbPath: 'data/database/afl_predictions.db',
      outputDir: 'data/predictions/margin'
    }));
    expect(payload.params.optimizedWinModelPath).toBeUndefined();

    expect(document.getElementById('logRunLabel').textContent).toContain('run #33');
    expect(document.getElementById('scriptLogsOutput').textContent).toContain('Predictions started');
  });

  test('loads selected run details and appends logs from history actions', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => buildMetadataResponse()
        });
      }

      if (url === '/admin/api/script-runs?limit=30') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: [
              {
                run_id: 41,
                script_key: 'win-margin-methods-predictions',
                status: 'completed',
                created_at: '2026-04-03T09:00:00.000Z',
                finished_at: '2026-04-03T09:10:00.000Z',
                created_by_name: 'Admin'
              }
            ]
          })
        });
      }

      if (url === '/admin/api/script-runs/41') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            run: {
              run_id: 41,
              script_key: 'win-margin-methods-predictions',
              status: 'completed'
            }
          })
        });
      }

      if (url === '/admin/api/script-runs/41/logs?afterSeq=0&limit=500') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            logs: [
              {
                created_at: '2026-04-03T09:05:00.000Z',
                stream: 'stderr',
                message: 'Finished successfully'
              }
            ],
            lastSeq: 4
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    document.querySelector('[data-action="view-run-logs"]').click();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('logRunLabel').textContent).toContain('run #41');
    expect(document.getElementById('scriptLogsOutput').textContent).toContain('Finished successfully');
    expect(document.querySelector('.selected-run-row')).not.toBeNull();
  });

  test('submits optimized prediction runs with remapped params and keeps submit disabled when a run becomes active', async () => {
    let historyCallCount = 0;

    global.fetch.mockImplementation((url, options) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => buildMetadataResponse()
        });
      }

      if (url === '/admin/api/script-runs?limit=30' && !options) {
        historyCallCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: historyCallCount === 1 ? [] : [
              {
                run_id: 57,
                script_key: 'win-margin-methods-predictions',
                status: 'running',
                created_at: '2026-04-03T10:00:00.000Z',
                started_at: '2026-04-03T10:00:05.000Z',
                created_by_name: 'Admin'
              }
            ]
          })
        });
      }

      if (url === '/admin/api/script-runs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            run: {
              runId: 57,
              status: 'running'
            }
          })
        });
      }

      if (url === '/admin/api/script-runs/57/logs?afterSeq=0&limit=500') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            logs: [],
            lastSeq: 0
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    document.getElementById('predictionsMode').value = 'optimized';
    document.getElementById('optimizedWinModelPath').value =
      'data/models/win/afl_elo_win_trained_to_2025.json';
    document.getElementById('optimizedMarginMethodsPath').value =
      'data/models/win/optimal_margin_methods_trained_to_2025.json';
    document.getElementById('optimizedPredictorId').value = '7';
    document.getElementById('optimizedDbPath').value = 'data/database/afl_predictions.db';
    document.getElementById('optimizedOutputDir').value = 'data/predictions/win';
    document.getElementById('optimizedMethodOverride').value = 'simple';
    document.getElementById('optimizedAllowModelMismatch').checked = true;
    document.getElementById('optimizedFutureOnly').checked = true;
    document.getElementById('optimizedSaveToDb').checked = true;
    document.getElementById('optimizedOverrideCompleted').checked = false;

    document.querySelector('.script-run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const postCall = global.fetch.mock.calls.find(([url]) => url === '/admin/api/script-runs');
    const payload = JSON.parse(postCall[1].body);

    expect(payload.scriptKey).toBe('win-margin-methods-predictions');
    expect(payload.params).toEqual(expect.objectContaining({
      winModelPath: 'data/models/win/afl_elo_win_trained_to_2025.json',
      marginMethodsPath: 'data/models/win/optimal_margin_methods_trained_to_2025.json',
      predictorId: '7',
      dbPath: 'data/database/afl_predictions.db',
      outputDir: 'data/predictions/win',
      methodOverride: 'simple',
      allowModelMismatch: true
    }));
    expect(payload.params.marginModelPath).toBeUndefined();
    expect(payload.params.combinedPredictorId).toBeUndefined();
    expect(document.getElementById('activeRunBanner').textContent).toContain('Run #57');
    expect(document.querySelector('.script-run-form button[type="submit"]').disabled).toBe(true);
  });

  test('ignores invalid history run ids and surfaces run-detail failures', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => buildMetadataResponse()
        });
      }

      if (url === '/admin/api/script-runs?limit=30') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: []
          })
        });
      }

      if (url === '/admin/api/script-runs/44') {
        return Promise.resolve({
          ok: false,
          json: async () => ({
            success: false,
            error: 'Unable to load run details'
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    const tbody = document.getElementById('scriptRunHistoryBody');
    tbody.innerHTML = `
      <tr><td><button data-action="view-run-logs" data-run-id="not-a-number">Invalid</button></td></tr>
      <tr><td><button data-action="view-run-logs" data-run-id="44">Valid</button></td></tr>
    `;

    tbody.querySelector('[data-run-id="not-a-number"]').click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    tbody.querySelector('[data-run-id="44"]').click();
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('scriptsPageError').textContent).toBe('Unable to load run details');
  });

  test('refresh loop skips overlapping refreshes and reports polling failures', async () => {
    let refreshMode = 'ready';
    let resolvePendingRefresh;
    const pendingRefresh = new Promise((resolve) => {
      resolvePendingRefresh = resolve;
    });

    global.fetch.mockImplementation((url) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => buildMetadataResponse()
        });
      }

      if (url === '/admin/api/script-runs?limit=30') {
        if (refreshMode === 'pending') {
          return pendingRefresh;
        }

        if (refreshMode === 'error') {
          return Promise.resolve({
            ok: false,
            json: async () => ({
              success: false,
              error: 'Polling failed'
            })
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: [
              {
                run_id: 41,
                script_key: 'win-margin-methods-predictions',
                status: 'completed',
                created_at: '2026-04-03T09:00:00.000Z',
                finished_at: '2026-04-03T09:10:00.000Z',
                created_by_name: 'Admin'
              }
            ]
          })
        });
      }

      if (url === '/admin/api/script-runs/41') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            run: {
              run_id: 41,
              script_key: 'win-margin-methods-predictions',
              status: 'completed'
            }
          })
        });
      }

      if (url === '/admin/api/script-runs/41/logs?afterSeq=0&limit=500') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            logs: [],
            lastSeq: 0
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    document.querySelector('[data-action="view-run-logs"]').click();
    await flushPromises();
    await flushPromises();

    const refreshLoop = getRefreshLoopCallback();
    const fetchCountBeforeLoop = global.fetch.mock.calls.length;

    refreshMode = 'pending';
    const firstRefresh = refreshLoop();
    const secondRefresh = refreshLoop();
    await flushPromises();

    expect(global.fetch.mock.calls.length).toBe(fetchCountBeforeLoop + 1);

    resolvePendingRefresh({
      ok: true,
      json: async () => ({
        success: true,
        runs: []
      })
    });
    await firstRefresh;
    await secondRefresh;

    refreshMode = 'error';
    await refreshLoop();

    expect(document.getElementById('scriptsPageError').textContent).toBe('Polling failed');
  });

  test('shows a page error when metadata loading fails', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: false,
          json: async () => ({
            success: false,
            error: 'Metadata unavailable'
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('scriptsPageError').textContent).toBe('Metadata unavailable');
    expect(document.getElementById('scriptsPageError').style.display).toBe('block');
    expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);
  });

  test('renders no-option metadata safely and preserves custom optimize output paths', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/admin/api/script-metadata') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            defaults: {
              currentYear: 2026,
              yearMax: 2026,
              dbPath: 'data/database/afl_predictions.db'
            },
            modelFiles: {
              win: [],
              margin: [],
              history: [],
              winMarginMethods: []
            },
            activePredictors: []
          })
        });
      }

      if (url === '/admin/api/script-runs?limit=30') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            runs: []
          })
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('admin-scripts.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('scriptRunHistoryBody').textContent).toContain('No runs yet.');
    expect(document.getElementById('activeRunBanner').style.display).toBe('none');
    expect(document.querySelector('.script-run-form button[type="submit"]').disabled).toBe(false);

    expect(document.getElementById('optimizedWinModelPath').textContent).toContain('No options available');
    expect(document.getElementById('combinedPredictorId').textContent).toContain('No options available');

    const winTrainParams = document.getElementById('winTrainParamsFile');
    expect(winTrainParams.options).toHaveLength(2);
    expect(winTrainParams.options[0].textContent).toBe('None');
    expect(winTrainParams.options[1].textContent).toBe('No options available');

    const trainModeSelect = document.getElementById('trainOptimizationTarget');
    trainModeSelect.value = 'margin';
    trainModeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(document.getElementById('trainWinPanel').style.display).toBe('none');
    expect(document.getElementById('trainMarginPanel').style.display).toBe('block');

    const outputPathInput = document.getElementById('marginOptimizeOutputPath');
    const endYearInput = document.getElementById('marginOptimizeEndYear');
    expect(outputPathInput.value).toBe('data/models/margin/optimal_margin_only_elo_params_trained_to_2025.json');
    expect(outputPathInput.dataset.autoManaged).toBe('true');

    outputPathInput.value = 'data/models/margin/custom_margin_params.json';
    outputPathInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(outputPathInput.dataset.autoManaged).toBe('false');

    endYearInput.value = '2024';
    endYearInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(outputPathInput.value).toBe('data/models/margin/custom_margin_params.json');

    const modeSelect = document.getElementById('predictionsMode');
    modeSelect.value = 'invalid-mode';
    modeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(document.getElementById('optimizedPanel').style.display).toBe('block');
    expect(document.getElementById('marginPanel').style.display).toBe('none');
  });
});
