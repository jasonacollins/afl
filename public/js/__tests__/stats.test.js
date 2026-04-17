const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

describe('public/js/stats.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalFetch;
  let originalAlert;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <meta name="csrf-token" content="stats-csrf-token">
      <div class="stats-container" data-year="2026" data-user-id="7"></div>
      <button class="round-button" data-round="OR">Opening Round</button>
      <button class="round-button" data-round="1">Round 1</button>
      <label>
        <input type="checkbox" class="exclude-checkbox" data-predictor-id="11">
      </label>
      <div id="round-stats-container" class="is-hidden"></div>
      <div id="round-display"></div>
      <div id="round-stats-content"></div>
      <div id="cumulative-display"></div>
      <div id="cumulative-stats-content"></div>
    `, { url: 'https://example.test/matches/stats?year=2026' });
    restoreDomGlobals = installDomGlobals(dom);

    originalFetch = global.fetch;
    originalAlert = global.alert;
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.alert = jest.fn();
    window.alert = global.alert;
    window.location.reload = jest.fn();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (typeof originalFetch === 'undefined') {
      delete global.fetch;
      delete window.fetch;
    } else {
      global.fetch = originalFetch;
      window.fetch = originalFetch;
    }

    if (typeof originalAlert === 'undefined') {
      delete global.alert;
      delete window.alert;
    } else {
      global.alert = originalAlert;
      window.alert = originalAlert;
    }

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    restoreDomGlobals();
    dom.window.close();
  });

  test('loads saved exclusions and persists checkbox changes with CSRF protection', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/excluded-predictors') {
        return Promise.resolve({
          json: async () => ({ excludedPredictors: ['11'] })
        });
      }

      if (url === '/admin/api/excluded-predictors') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true })
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    const checkbox = document.querySelector('.exclude-checkbox');
    expect(checkbox.checked).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/admin/api/excluded-predictors', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'stats-csrf-token'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ predictorIds: [] });
    expect(window.location.reload).toHaveBeenCalled();
  });

  test('loads and renders round statistics for the selected round', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/excluded-predictors') {
        return Promise.resolve({
          json: async () => ({ excludedPredictors: [] })
        });
      }

      if (url === '/matches/stats/round/1?year=2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            roundPredictorStats: [
              {
                id: 7,
                display_name: 'Dad\'s AI',
                brierScore: '0.1200',
                bitsScore: '0.4500',
                tipPoints: 5,
                totalPredictions: 6,
                tipAccuracy: '83.3',
                marginMAE: '11.2'
              }
            ],
            cumulativePredictorStats: [
              {
                id: 7,
                display_name: 'Dad\'s AI',
                brierScore: '0.1400',
                bitsScore: '1.2000',
                tipPoints: 12,
                totalPredictions: 15,
                tipAccuracy: '80.0',
                marginMAE: '10.5'
              }
            ]
          })
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    document.querySelector('.round-button[data-round="1"]').click();
    await flushPromises();

    expect(document.getElementById('round-stats-container').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('round-display').textContent).toBe('Round 1');
    expect(document.getElementById('cumulative-display').textContent).toBe('Round 1');
    expect(document.getElementById('round-stats-content').textContent).toContain("Dad's AI");
    expect(document.getElementById('round-stats-content').textContent).toContain('(You)');
    expect(document.getElementById('cumulative-stats-content').textContent).toContain("Dad's AI");
  });

  test('shows opening round label and empty-state message when no round results are available', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/excluded-predictors') {
        return Promise.resolve({
          json: async () => ({ excludedPredictors: [] })
        });
      }

      if (url === '/matches/stats/round/OR?year=2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            roundPredictorStats: [
              { id: 7, totalPredictions: 0 }
            ],
            cumulativePredictorStats: [
              { id: 7, totalPredictions: 0 }
            ]
          })
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    document.querySelector('.round-button[data-round="OR"]').click();
    await flushPromises();

    expect(document.getElementById('round-display').textContent).toBe('Opening Round');
    expect(document.getElementById('cumulative-display').textContent).toBe('Opening Round');
    expect(document.getElementById('round-stats-content').textContent).toContain(
      'No prediction results available for this round.'
    );
    expect(document.getElementById('cumulative-stats-content').textContent).toContain(
      'No cumulative prediction results available through this round.'
    );
  });

  test('alerts and avoids reload when saving exclusions returns a non-ok response', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/excluded-predictors') {
        return Promise.resolve({
          json: async () => ({ excludedPredictors: [] })
        });
      }

      if (url === '/admin/api/excluded-predictors') {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => 'server error'
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    const checkbox = document.querySelector('.exclude-checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('Failed to save exclusions: 500');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  test('alerts on exclusion-save network errors and renders fetch failures for round stats', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/excluded-predictors') {
        return Promise.resolve({
          json: async () => ({ excludedPredictors: [] })
        });
      }

      if (url === '/admin/api/excluded-predictors') {
        return Promise.reject(new Error('network down'));
      }

      if (url === '/matches/stats/round/1?year=2026') {
        return Promise.reject(new Error('round stats failed'));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    const checkbox = document.querySelector('.exclude-checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('Error saving exclusions: network down');
    expect(window.location.reload).not.toHaveBeenCalled();

    document.querySelector('.round-button[data-round="1"]').click();
    await flushPromises();

    expect(document.getElementById('round-stats-content').textContent).toContain(
      'Error loading round statistics.'
    );
    expect(document.getElementById('cumulative-stats-content').textContent).toContain(
      'Error loading cumulative statistics.'
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('logs but tolerates failures while loading saved exclusions', async () => {
    global.fetch.mockRejectedValue(new Error('initial load failed'));

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error loading saved exclusions:',
      expect.any(Error)
    );
  });

  test('renders server-declared round-stat errors and tolerates missing cumulative containers', async () => {
    restoreDomGlobals();
    dom.window.close();

    dom = createDom(`
      <button class="round-button" data-round="2">Round 2</button>
      <div id="round-stats-container" class="is-hidden"></div>
      <div id="round-display"></div>
      <div id="round-stats-content"></div>
    `, { url: 'https://example.test/matches/stats?year=2026' });
    restoreDomGlobals = installDomGlobals(dom);

    global.fetch.mockImplementation((url) => {
      if (url === '/api/excluded-predictors') {
        return Promise.resolve({
          json: async () => ({ excludedPredictors: [] })
        });
      }

      if (url === '/matches/stats/round/2?year=undefined') {
        return Promise.resolve({
          json: async () => ({ success: false })
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    document.querySelector('.round-button[data-round="2"]').click();
    await flushPromises();

    expect(document.getElementById('round-display').textContent).toBe('Round 2');
    expect(document.getElementById('round-stats-content').textContent).toContain(
      'Error loading round statistics.'
    );
  });
});
