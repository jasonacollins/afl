const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

function buildEloDom() {
  return `
    <div class="elo-chart-section">
      <div id="year-controls"></div>
      <div id="year-range-controls" class="is-hidden"></div>
      <select id="year-selector"></select>
      <select id="start-year"></select>
      <select id="end-year"></select>
      <input type="radio" name="chart-mode" value="year" checked>
      <input type="radio" name="chart-mode" value="yearRange">
      <div id="elo-chart" class="elo-chart-container">
        <canvas id="elo-chart-canvas"></canvas>
      </div>
    </div>
  `;
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

function buildSingleYearResponse() {
  return {
    success: true,
    data: [
      { x: 0, round: 'Season start', year: 2026, Cats: 1500, Swans: 1480 },
      {
        x: 1,
        round: '1',
        year: 2026,
        type: 'after_game',
        Cats: 1512,
        Swans: 1468,
        Cats_match: { opponent: 'Swans', score: 90, opponent_score: 80, result: 'win' }
      }
    ],
    teams: ['Cats', 'Swans'],
    teamColors: {
      Cats: '#123456',
      Swans: '#654321'
    }
  };
}

function buildRangeResponse() {
  return {
    success: true,
    data: [
      { x: 0, label: '2025', year: 2025, round: 'Season start', Cats: 1490, Swans: 1475 },
      { x: 10, label: '2026', year: 2026, round: 'Season start', Cats: 1500, Swans: 1480 }
    ],
    teams: ['Cats', 'Swans'],
    teamColors: {
      Cats: '#123456',
      Swans: '#654321'
    },
    yearLabels: [
      [0, 2025],
      [10, 2026]
    ]
  };
}

describe('public/js/elo-chart.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalFetch;
  let originalAlert;
  let originalChart;
  let chartInstances;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(buildEloDom(), { url: 'https://example.test/elo' });
    restoreDomGlobals = installDomGlobals(dom);

    originalFetch = global.fetch;
    originalAlert = global.alert;
    originalChart = global.Chart;
    chartInstances = [];

    const canvas = document.getElementById('elo-chart-canvas');
    canvas.getContext = jest.fn(() => ({ mocked: true }));
    window.HTMLCanvasElement = window.HTMLElement;
    makeWritableSelectValue(document.getElementById('year-selector'));
    makeWritableSelectValue(document.getElementById('start-year'));
    makeWritableSelectValue(document.getElementById('end-year'));

    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.alert = jest.fn();
    window.alert = global.alert;
    global.Chart = jest.fn().mockImplementation(function ChartMock(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.destroy = jest.fn();
      this.update = jest.fn();
      this.getDatasetMeta = jest.fn(() => ({ hidden: false }));
      chartInstances.push(this);
      return this;
    });
    window.Chart = global.Chart;
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

    if (typeof originalChart === 'undefined') {
      delete global.Chart;
      delete window.Chart;
    } else {
      global.Chart = originalChart;
      window.Chart = originalChart;
    }

    restoreDomGlobals();
    dom.window.close();
  });

  test('auto-initializes, renders the chart, and toggles team highlighting from the legend', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026, 2025] })
        });
      }

      if (url === '/api/elo/ratings/2026') {
        return Promise.resolve({
          json: async () => buildSingleYearResponse()
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('elo-chart.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    expect(window.eloChart).toBeDefined();
    expect(document.getElementById('year-selector').innerHTML).toContain('2026');
    expect(global.Chart).toHaveBeenCalled();
    expect(document.querySelectorAll('.legend-item')).toHaveLength(2);

    document.querySelector('.legend-item[data-team="Cats"]').click();

    expect(global.Chart).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.legend-item[data-team="Cats"]').classList.contains('highlighted')).toBe(true);
    expect(chartInstances[1].config.data.datasets[0].label).toBe('Cats');
  });

  test('validates year range input and loads year-range data when valid', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026, 2025] })
        });
      }

      if (url === '/api/elo/ratings/2026') {
        return Promise.resolve({
          json: async () => buildSingleYearResponse()
        });
      }

      if (url === '/api/elo/ratings/range?startYear=2025&endYear=2026') {
        return Promise.resolve({
          json: async () => buildRangeResponse()
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('elo-chart.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    document.getElementById('start-year').value = '2026';
    document.getElementById('end-year').value = '2025';
    await window.eloChart.applyYearRange();
    expect(global.alert).toHaveBeenCalledWith('Start year must be before or equal to end year');

    document.getElementById('start-year').value = '2025';
    document.getElementById('end-year').value = '2026';
    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    expect(window.eloChart.currentMode).toBe('yearRange');
    expect(global.fetch).toHaveBeenCalledWith('/api/elo/ratings/range?startYear=2025&endYear=2026');
    expect(document.getElementById('year-controls').classList.contains('is-hidden')).toBe(true);
    expect(document.getElementById('year-range-controls').classList.contains('is-hidden')).toBe(false);
  });

  test('shows an error when changing to an invalid year', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026] })
        });
      }

      if (url === '/api/elo/ratings/2026') {
        return Promise.resolve({
          json: async () => buildSingleYearResponse()
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('elo-chart.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises();
    await flushPromises();

    await window.eloChart.changeYear(Number.NaN);

    expect(document.getElementById('elo-chart').textContent).toContain('Failed to load data for NaN');
  });
});
