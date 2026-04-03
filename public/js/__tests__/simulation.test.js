const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

function buildSimulationDom() {
  return `
    <div id="loading-indicator"></div>
    <div id="error-message" class="is-hidden"><span id="error-text"></span></div>
    <div id="summary-stats" class="is-hidden">
      <span id="num-simulations"></span>
      <span id="completed-matches"></span>
      <span id="completed-subtext"></span>
      <span id="remaining-matches"></span>
    </div>
    <div id="table-container" class="is-hidden">
      <table id="simulation-table">
        <thead>
          <tr>
            <th class="sortable" data-sort="team">Team</th>
            <th class="sortable" data-sort="premiership">Flag</th>
          </tr>
        </thead>
        <tbody id="simulation-tbody"></tbody>
      </table>
    </div>
    <select id="year-select"><option value="2026" selected>2026</option></select>
    <div id="simulation-title"></div>
    <div id="ladder-position-card" class="is-hidden">
      <table>
        <thead><tr id="matrix-header"></tr></thead>
        <tbody id="matrix-tbody"></tbody>
      </table>
    </div>
    <div id="round-snapshot-nav" class="is-hidden">
      <div id="round-tabs"></div>
      <div id="round-snapshot-context"></div>
    </div>
    <th id="top10-header"></th>
    <th id="top6-header"></th>
    <th id="top8-header"></th>
    <th id="wildcard-header"></th>
    <th id="finals-week-header"></th>
  `;
}

function makeWritableSelectValue(element, initialValue) {
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

function buildTeam(name, overrides = {}) {
  return {
    team: name,
    current_elo: 1500,
    current_wins: 3,
    current_losses: 1,
    current_draws: 0,
    projected_wins: 15.2,
    wins_10th_percentile: 13.1,
    wins_90th_percentile: 17.4,
    finals_probability: 0.8,
    wildcard_probability: 0.1,
    finals_week2_probability: 0.65,
    top4_probability: 0.55,
    prelim_probability: 0.3,
    grand_final_probability: 0.18,
    premiership_probability: 0.11,
    ladder_position_probabilities: {
      1: 0.3,
      2: 0.2
    },
    ...overrides
  };
}

function buildSimulationResponse(year) {
  if (year === 2025) {
    return {
      success: true,
      year: 2025,
      num_simulations: 50000,
      completed_matches: 30,
      remaining_matches: 168,
      current_round_label: 'Before Round 5',
      results: [
        buildTeam('Cats', { premiership_probability: 0.2 }),
        buildTeam('Swans', { projected_wins: 14.1, ladder_position_probabilities: { 1: 0.1, 2: 0.3 } })
      ]
    };
  }

  return {
    success: true,
    year: 2026,
    current_round_key: 'round-2-current',
    current_round_label: 'Current Round 2',
    num_simulations: 50000,
    completed_matches: 12,
    remaining_matches: 195,
    last_updated: '2026-04-03T10:00:00.000Z',
    round_snapshots: [
      {
        round_key: 'round-1',
        round_label: 'Before Round 1',
        round_tab_label: 'R1',
        round_order: 1,
        completed_matches: 0,
        remaining_matches: 207,
        num_simulations: 50000,
        results: [
          buildTeam('Cats', { projected_wins: 14.2 }),
          buildTeam('Swans', { projected_wins: 13.5, ladder_position_probabilities: { 1: 0.05, 2: 0.22 } })
        ]
      },
      {
        round_key: 'round-2-current',
        round_label: 'Current Round 2',
        round_tab_label: 'Current',
        round_order: 2,
        completed_matches: 12,
        remaining_matches: 195,
        num_simulations: 50000,
        results: [
          buildTeam('Cats', { projected_wins: 15.2 }),
          buildTeam('Swans', { projected_wins: 14.6, ladder_position_probabilities: { 1: 0.07, 2: 0.25 } })
        ]
      }
    ]
  };
}

describe('public/js/simulation.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalFetch;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(buildSimulationDom(), { url: 'https://example.test/simulation' });
    restoreDomGlobals = installDomGlobals(dom);
    makeWritableSelectValue(dom.window.document.getElementById('year-select'), '2026');

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

  test('loads simulation snapshots, renders 2026 finals columns, and switches tabs', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026, 2025] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => buildSimulationResponse(2026)
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('simulation.js');
    if (document.readyState === 'loading') {
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('simulation-title').textContent).toContain('2026 AFL Season Simulation');
    expect(document.getElementById('top10-header').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('top8-header').classList.contains('is-hidden')).toBe(true);
    expect(document.getElementById('finals-week-header').textContent).toBe('Finals Week 2');
    expect(document.querySelectorAll('#round-tabs .simulation-round-button')).toHaveLength(2);
    expect(document.getElementById('simulation-tbody').textContent).toContain('Cats');
    expect(document.getElementById('matrix-tbody').textContent).toContain('Swans');

    document.querySelector('[data-round-key="round-1"]').click();

    expect(document.getElementById('round-snapshot-context').textContent).toBe('Before Round 1');
    expect(document.getElementById('completed-subtext').textContent).toContain('Before Round 1');
  });

  test('switches to a 2025 simulation and restores legacy finals columns', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026, 2025] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => buildSimulationResponse(2026)
        });
      }

      if (url === '/api/simulation/2025') {
        return Promise.resolve({
          json: async () => buildSimulationResponse(2025)
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('simulation.js');
    if (document.readyState === 'loading') {
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await flushPromises();
    await flushPromises();

    const yearSelect = document.getElementById('year-select');
    yearSelect.value = '2025';
    yearSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('top10-header').classList.contains('is-hidden')).toBe(true);
    expect(document.getElementById('top8-header').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('finals-week-header').textContent).toBe('Finals Week 1');
    expect(document.getElementById('round-snapshot-nav').classList.contains('is-hidden')).toBe(true);
  });

  test('shows an error message when simulation data fails to load', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.reject(new Error('network down'));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadBrowserScript('simulation.js');
    if (document.readyState === 'loading') {
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('error-message').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('error-text').textContent).toBe('Failed to load simulation data. Please try again later.');
  });
});
