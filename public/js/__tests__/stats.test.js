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

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <meta name="csrf-token" content="stats-csrf-token">
      <div class="stats-container" data-year="2026" data-user-id="7"></div>
      <button class="round-button" data-round="1">Round 1</button>
      <label>
        <input type="checkbox" class="exclude-checkbox" data-predictor-id="11">
      </label>
      <div id="round-stats-container" class="is-hidden"></div>
      <div id="round-display"></div>
      <div id="round-stats-content"></div>
    `, { url: 'https://example.test/matches/stats?year=2026' });
    restoreDomGlobals = installDomGlobals(dom);

    originalFetch = global.fetch;
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    window.location.reload = jest.fn();
  });

  afterEach(() => {
    if (typeof originalFetch === 'undefined') {
      delete global.fetch;
      delete window.fetch;
    } else {
      global.fetch = originalFetch;
      window.fetch = originalFetch;
    }

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
            ]
          })
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    loadBrowserScript('stats.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();

    document.querySelector('.round-button').click();
    await flushPromises();

    expect(document.getElementById('round-stats-container').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('round-display').textContent).toBe('Round 1');
    expect(document.getElementById('round-stats-content').textContent).toContain("Dad's AI");
    expect(document.getElementById('round-stats-content').textContent).toContain('(You)');
  });
});
