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

  function installHomeDom(html, url = 'https://example.test/?year=2024') {
    dom = createDom(html, { url });
    restoreDomGlobals = installDomGlobals(dom);

    originalFetch = global.fetch;
    global.fetch = jest.fn();
    window.fetch = global.fetch;
  }

  beforeEach(() => {
    jest.resetModules();

    installHomeDom(`
      <div class="performance-card" data-selected-year="2025" data-featured-predictor-id="6"></div>
      <div class="round-buttons">
        <button class="round-button" data-round="1">Round 1</button>
        <button class="round-button" data-round="2">Round 2</button>
      </div>
      <div id="predictions-table-container"></div>
    `);
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

  test('falls back to the URL year when the selected year button href is invalid and no featured predictor is set', async () => {
    restoreDomGlobals();
    dom.window.close();

    installHomeDom(`
      <a class="year-button selected" href="http://[">Broken link</a>
      <div class="round-buttons">
        <button class="round-button" data-round="1">Round 1</button>
      </div>
      <div id="predictions-table-container"></div>
    `);

    global.fetch.mockResolvedValue({
      json: async () => ({ matches: [], predictions: {} })
    });

    loadBrowserScript('home.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.round-button[data-round="1"]').click();
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/featured-predictions/1?year=2024');
    expect(document.getElementById('predictions-table-container').textContent).toContain('No matches available for this round');
  });

  test('renders home, away, draw, correct, partial, and incorrect result states', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({
        matches: [
          {
            match_id: 1,
            match_date: '2025-04-10T09:30:00.000Z',
            venue: 'MCG',
            home_team: 'Cats',
            away_team: 'Swans',
            hscore: 90,
            ascore: 80,
            metrics: { correct: true }
          },
          {
            match_id: 2,
            match_date: '2025-04-11T09:30:00.000Z',
            venue: 'Gabba',
            home_team: 'Lions',
            away_team: 'Crows',
            hscore: 70,
            ascore: 70,
            metrics: { partial: true }
          },
          {
            match_id: 3,
            match_date: '2025-04-12T09:30:00.000Z',
            venue: 'Optus Stadium',
            home_team: 'Dockers',
            away_team: 'Eagles',
            hscore: 60,
            ascore: 80,
            metrics: { correct: false, partial: false }
          }
        ],
        predictions: {
          1: { probability: 60, predicted_margin: 12 },
          2: { probability: 50, tipped_team: 'home', predicted_margin: 0 },
          3: { probability: 40, predicted_margin: -7 }
        }
      })
    });

    loadBrowserScript('home.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.round-button[data-round="1"]').click();
    await flushPromises();
    await flushPromises();

    const tableText = document.getElementById('predictions-table-container').textContent;
    expect(tableText).toContain('60% Cats');
    expect(tableText).toContain('50% draw (tipped: Lions)');
    expect(tableText).toContain('60% Eagles');
    expect(tableText).toContain('Correct');
    expect(tableText).toContain('Draw');
    expect(tableText).toContain('Incorrect');
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
