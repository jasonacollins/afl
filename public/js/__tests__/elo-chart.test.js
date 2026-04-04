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
  let consoleErrorSpy;
  let consoleLogSpy;

  async function initializeChart(overrides = {}) {
    global.fetch.mockImplementation((url) => {
      if (typeof overrides[url] === 'function') {
        return overrides[url]();
      }

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

      if (url === '/api/elo/ratings/2025') {
        return Promise.resolve({
          json: async () => ({
            ...buildSingleYearResponse(),
            data: [
              { x: 0, round: 'Season start', year: 2025, Cats: 1490, Swans: 1475 }
            ]
          })
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
  }

  function getLatestChartConfig() {
    return chartInstances[chartInstances.length - 1].config;
  }

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

    if (typeof originalChart === 'undefined') {
      delete global.Chart;
      delete window.Chart;
    } else {
      global.Chart = originalChart;
      window.Chart = originalChart;
    }

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
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
    await initializeChart({
      '/api/elo/years': () => Promise.resolve({
        json: async () => ({ success: true, years: [2026] })
      })
    });

    await window.eloChart.changeYear(Number.NaN);

    expect(document.getElementById('elo-chart').textContent).toContain('Failed to load data for NaN');
  });

  test('supports switching back to single-year mode and toggling dataset visibility', async () => {
    await initializeChart();

    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    document.getElementById('year-selector').value = '2025';
    await window.eloChart.handleModeChange('year');
    await flushPromises();

    expect(window.eloChart.currentMode).toBe('year');
    expect(global.fetch).toHaveBeenCalledWith('/api/elo/ratings/2025');
    expect(document.getElementById('year-controls').classList.contains('is-hidden')).toBe(false);

    window.eloChart.toggleTeamVisibility(0);
    expect(chartInstances[chartInstances.length - 1].update).toHaveBeenCalled();
  });

  test('chart helper methods handle round labels, carryover gaps, and season dataset splitting', async () => {
    await initializeChart();

    const xAxisLabels = window.eloChart.buildXAxisLabelMap([
      { x: 0, round: 'Season start' },
      { x: 1, round: '1' },
      { x: 2.4, round: 'ignored' }
    ]);

    expect(window.eloChart.getRoundLabelForX(1, xAxisLabels)).toBe('1');
    expect(window.eloChart.getRoundLabelForX(2.4, xAxisLabels)).toBe('');
    expect(window.eloChart.formatRoundTitle('Season start')).toBe('Season start');
    expect(window.eloChart.formatRoundTitle('2')).toBe('Round 2');

    window.eloChart.chartData = [
      { x: 0, year: 2025, type: 'before' },
      { x: 1, year: 2025, type: 'after_game' },
      { x: 10, year: 2026, type: 'season_start' }
    ];

    expect(window.eloChart.isSeasonStart({ year: 2026 }, 2)).toBe(true);
    expect(window.eloChart.shouldHideCarryoverSegment({ x: 1 }, { x: 10 })).toBe(true);
    expect(window.eloChart.shouldHideCarryoverSegment({ x: 0 }, { x: 1 })).toBe(false);

    const seasonDatasets = window.eloChart.createSeasonDatasets([
      { x: 0, y: 1490 },
      { x: 1, y: 1500 },
      { x: 10, y: 1510 }
    ], 'Cats', '#123456');

    expect(seasonDatasets).toHaveLength(2);
    expect(seasonDatasets[0].label).toBe('Cats');
    expect(seasonDatasets[1].seasonYear).toBe(2026);
  });

  test('tooltip and axis callbacks format titles, labels, and year ticks', async () => {
    await initializeChart();

    let config = getLatestChartConfig();
    let tooltipCallbacks = config.options.plugins.tooltip.callbacks;

    expect(tooltipCallbacks.title([
      {
        raw: { year: 2026, round: '1' },
        parsed: { x: 1 }
      }
    ])).toBe('Round 1');

    expect(tooltipCallbacks.title([
      {
        raw: {
          year: 2026,
          round: '1',
          match: { opponent: 'Swans', score: 90, opponent_score: 80, result: 'win' }
        },
        parsed: { y: 1512.34 },
        dataset: { label: 'Cats' }
      }
    ])).toBe('Round 1');

    expect(tooltipCallbacks.label({
      raw: {
        match: { opponent: 'Swans', score: 90, opponent_score: 80, result: 'win' }
      },
      parsed: { y: 1512.34 },
      dataset: { label: 'Cats' }
    })).toEqual([
      'Cats: 1512.3',
      'vs Swans 90-80 (Win)'
    ]);

    expect(tooltipCallbacks.label({
      raw: {},
      parsed: { y: 1480 },
      dataset: { label: 'Swans' }
    })).toBe('Swans: 1480');

    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    config = getLatestChartConfig();
    tooltipCallbacks = config.options.plugins.tooltip.callbacks;

    expect(tooltipCallbacks.title([
      {
        raw: { year: 2026, round: 'Season start' },
        parsed: { x: 10 }
      }
    ])).toBe('Year 2026');

    expect(tooltipCallbacks.title([
      {
        raw: {},
        parsed: { x: 10 }
      }
    ])).toBe('Year 2026');

    expect(tooltipCallbacks.title([
      {
        raw: {},
        parsed: { x: 999 }
      }
    ])).toBe('Year Range');

    const axis = { ticks: [] };
    config.options.scales.x.afterBuildTicks(axis);
    expect(axis.ticks).toEqual([
      { value: 0, label: '2025' },
      { value: 10, label: '2026' }
    ]);
    expect(config.options.scales.x.ticks.callback(10)).toBe('2026');
    expect(config.options.scales.x.ticks.callback(11)).toBe('');
  });

  test('highlight rebuild keeps highlighted teams on top and dims faded teams', async () => {
    await initializeChart();

    window.eloChart.toggleTeamHighlight('Cats');

    const config = getLatestChartConfig();
    expect(config.data.datasets.map((dataset) => dataset.label)).toEqual(['Cats', 'Swans']);
    expect(config.data.datasets[0].borderWidth).toBe(4);
    expect(config.data.datasets[1].borderWidth).toBe(1);
    expect(config.data.datasets[0].segment.borderColor({ p0DataIndex: 0, p1DataIndex: 1 })).toBe('#123456');
    expect(config.data.datasets[1].segment.borderColor({ p0DataIndex: 0, p1DataIndex: 1 })).toBe('#cccccc');
    expect(document.querySelector('.legend-item[data-team="Cats"]').classList.contains('highlighted')).toBe(true);
  });

  test('createLegend logs an error when the chart section is unavailable', async () => {
    await initializeChart();

    const section = document.querySelector('.elo-chart-section');
    section.remove();

    window.eloChart.createLegend();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Chart section not found for legend');
  });

  test('falls back cleanly when year loading fails and shows no-data errors', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.reject(new Error('years down'));
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

    expect(window.eloChart.availableYears).toEqual([2026]);

    window.eloChart.chartData = [];
    window.eloChart.teams = ['Cats'];
    window.eloChart.createChart();
    expect(document.getElementById('elo-chart').textContent).toContain('No data available for the selected period');

    document.getElementById('start-year').value = '';
    document.getElementById('end-year').value = '';
    await window.eloChart.applyYearRange();
    expect(global.alert).toHaveBeenCalledWith('Please select both start and end years');
  });

  test('falls back to the current year when the years endpoint returns an API error payload', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.resolve({
          json: async () => ({ success: false, error: 'years unavailable' })
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

    expect(window.eloChart.availableYears).toEqual([2026]);
    expect(document.getElementById('year-selector').innerHTML).toContain('2026');
  });

  test('filters invalid available years, picks the latest valid year, and falls back to palette colors', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: ['bad', '2024', '2026', null] })
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

    expect(window.eloChart.availableYears).toEqual([2026, 2024]);
    expect(window.eloChart.currentYear).toBe(2026);
    expect(window.eloChart.getTeamColor('Unknown Team', 1)).toBe('#00AA00');
  });

  test('disables the selector when the API reports no available years', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/elo/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [] })
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

    expect(window.eloChart.availableYears).toEqual([]);
    expect(document.getElementById('year-selector').disabled).toBe(true);
    expect(document.getElementById('year-selector').innerHTML).toContain('No years available');
  });

  test('tooltip callbacks format round, year-range, and match detail content', async () => {
    await initializeChart();

    const singleYearConfig = chartInstances[chartInstances.length - 1].config;
    const singleYearTooltip = singleYearConfig.options.plugins.tooltip.callbacks;

    expect(singleYearTooltip.title([
      {
        raw: { year: 2026, round: '1' },
        parsed: { x: 1 }
      }
    ])).toBe('Round 1');
    expect(singleYearTooltip.label({
      dataset: { label: 'Cats' },
      parsed: { y: 1512.2 },
      raw: {
        match: {
          opponent: 'Swans',
          score: 90,
          opponent_score: 80,
          result: 'win'
        }
      }
    })).toEqual(['Cats: 1512.2', 'vs Swans 90-80 (Win)']);

    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    const yearRangeConfig = chartInstances[chartInstances.length - 1].config;
    const yearRangeTooltip = yearRangeConfig.options.plugins.tooltip.callbacks;

    expect(yearRangeTooltip.title([
      {
        raw: { year: 2025, round: 'Season start' },
        parsed: { x: 0 }
      }
    ])).toBe('Year 2025');
  });

  test('chart callbacks handle click highlighting, year-range ticks, and tooltip fallbacks', async () => {
    await initializeChart();

    const initialConfig = chartInstances[chartInstances.length - 1].config;
    initialConfig.options.onClick(null, [{ datasetIndex: 1 }]);

    expect(document.querySelector('.legend-item[data-team="Swans"]').classList.contains('highlighted')).toBe(true);

    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    const yearRangeConfig = chartInstances[chartInstances.length - 1].config;
    const axis = { ticks: [] };
    yearRangeConfig.options.scales.x.afterBuildTicks(axis);
    expect(axis.ticks).toEqual([
      { value: 0, label: '2025' },
      { value: 10, label: '2026' }
    ]);
    expect(yearRangeConfig.options.scales.x.ticks.callback(10)).toBe('2026');

    await window.eloChart.handleModeChange('year');
    await flushPromises();

    const singleYearConfig = chartInstances[chartInstances.length - 1].config;
    expect(singleYearConfig.options.plugins.tooltip.callbacks.title([
      {
        raw: {},
        parsed: { x: 1 }
      }
    ])).toBe('Round 1');
  });

  test('highlighted chart callbacks fade non-selected teams and preserve tooltip fallbacks', async () => {
    await initializeChart();

    window.eloChart.highlightedTeams = new Set(['Cats']);
    window.eloChart.createChartWithHighlighting();

    const highlightedConfig = chartInstances[chartInstances.length - 1].config;
    const highlightedDatasets = highlightedConfig.data.datasets;
    const catsDataset = highlightedDatasets.find((dataset) => dataset.label === 'Cats');
    const swansDataset = highlightedDatasets.find((dataset) => dataset.label === 'Swans');

    expect(catsDataset.segment.borderColor({ p0DataIndex: 0, p1DataIndex: 1 })).toBe('#123456');
    expect(swansDataset.segment.borderColor({ p0DataIndex: 0, p1DataIndex: 1 })).toBe('#cccccc');
    expect(highlightedConfig.options.plugins.tooltip.callbacks.label({
      dataset: { label: 'Cats' },
      parsed: { y: 1501.04 },
      raw: {}
    })).toBe('Cats: 1501');

    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    const yearRangeConfig = chartInstances[chartInstances.length - 1].config;
    expect(yearRangeConfig.options.scales.x.ticks.callback(3)).toBe('');
    expect(yearRangeConfig.options.plugins.tooltip.callbacks.title([
      {
        raw: {},
        parsed: { x: 999 }
      }
    ])).toBe('Year Range');
    expect(yearRangeConfig.options.plugins.tooltip.callbacks.title([])).toBe('');
  });

  test('shows a chart creation error when Chart.js throws', async () => {
    await initializeChart();

    global.Chart.mockImplementationOnce(() => {
      throw new Error('chart failed');
    });

    window.eloChart.createChart();

    expect(document.getElementById('elo-chart').textContent).toContain('Failed to create chart: chart failed');
  });

  test('shows an explicit teams error when chart data loads without team metadata', async () => {
    await initializeChart();

    window.eloChart.chartData = [
      { x: 0, round: 'Season start', year: 2026, Cats: 1500 }
    ];
    window.eloChart.teams = [];
    window.eloChart.createChart();

    expect(document.getElementById('elo-chart').textContent).toContain('No teams data available');
  });

  test('logs a highlighting error when no chart data is available for the highlighted render path', async () => {
    await initializeChart();

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    window.eloChart.createChartWithHighlights(null, ['Cats'], new Set(['Cats']));

    expect(errorSpy).toHaveBeenCalledWith('No chart data available for highlighting');

    errorSpy.mockRestore();
  });

  test('reports a missing chart container when no container can be recreated', async () => {
    await initializeChart();

    document.getElementById('elo-chart-canvas').remove();
    document.querySelector('.elo-chart-container').remove();
    window.eloChart.createChart();

    expect(window.eloChart.container.textContent).toContain('Chart container not found');
  });

  test('updates legend state for exclusive selection and hidden datasets', async () => {
    await initializeChart();

    window.eloChart.selectTeamExclusive('Cats');
    expect(document.querySelector('.legend-item[data-team="Cats"]').classList.contains('highlighted')).toBe(true);
    expect(document.querySelector('.legend-item[data-team="Swans"]').classList.contains('highlighted')).toBe(false);

    window.eloChart.selectTeamExclusive('Cats');
    expect(document.querySelector('.legend-item[data-team="Cats"]').classList.contains('highlighted')).toBe(false);

    window.eloChart.chart.getDatasetMeta = jest.fn((index) => ({ hidden: index === 1 }));
    window.eloChart.createLegend();
    expect(document.querySelector('.legend-item[data-team="Swans"]').classList.contains('hidden')).toBe(true);
  });

  test('ignores legend creation when the chart section is unavailable', async () => {
    await initializeChart();

    document.getElementById('elo-chart-legend').remove();
    document.querySelector('.elo-chart-section').remove();

    expect(() => window.eloChart.createLegend()).not.toThrow();
    expect(document.getElementById('elo-chart-legend')).toBeNull();
  });

  test('shows a year-range error when the range fetch fails', async () => {
    await initializeChart({
      '/api/elo/ratings/range?startYear=2025&endYear=2026': () => Promise.reject(new Error('range down'))
    });

    document.getElementById('start-year').value = '2025';
    document.getElementById('end-year').value = '2026';
    await window.eloChart.handleModeChange('yearRange');
    await flushPromises();

    expect(document.getElementById('elo-chart').textContent).toContain('Failed to load data for selected year range');
  });
});
