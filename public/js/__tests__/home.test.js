const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

describe('public/js/home.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalFetch;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <div class="performance-card" data-selected-year="2025" data-featured-predictor-id="6"></div>
      <div class="round-buttons">
        <button class="round-button" data-round="1">Round 1</button>
        <button class="round-button" data-round="2">Round 2</button>
      </div>
      <div id="predictions-table-container"></div>
    `, { url: 'https://example.test/?year=2024' });
    restoreDomGlobals = installDomGlobals(dom);

    originalFetch = global.fetch;
    global.fetch = jest.fn();
    window.fetch = global.fetch;
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

  test('loads featured round predictions and renders the prediction table', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({
        matches: [
          {
            match_id: 22,
            match_date: '2025-04-10T09:30:00.000Z',
            venue: 'MCG',
            home_team: 'Cats',
            away_team: 'Swans',
            hscore: 90,
            ascore: 80,
            metrics: { correct: true }
          }
        ],
        predictions: {
          22: {
            probability: 50,
            tipped_team: 'away',
            predicted_margin: -4
          }
        }
      })
    });

    loadBrowserScript('home.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.round-button[data-round="2"]').click();
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/featured-predictions/2?year=2025&predictorId=6');
    expect(document.querySelector('.round-button[data-round="2"]').classList.contains('selected')).toBe(true);
    expect(document.getElementById('predictions-table-container').textContent).toContain('50% draw');
    expect(document.getElementById('predictions-table-container').textContent).toContain('Cats vs Swans');
    expect(document.getElementById('predictions-table-container').textContent).toContain('4.0');
  });

  test('shows an error message when featured predictions fail to load', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    loadBrowserScript('home.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.round-button[data-round="1"]').click();
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('predictions-table-container').textContent).toContain('Error loading predictions');
  });
});
