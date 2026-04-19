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
            <th class="sortable" data-sort="elo">ELO</th>
            <th class="sortable" data-sort="record">Record</th>
            <th class="sortable" data-sort="projected-wins">Wins</th>
            <th class="sortable" data-sort="top10">Top 10</th>
            <th class="sortable" data-sort="wildcard">Wildcard</th>
            <th class="sortable" data-sort="top6">Top 6</th>
            <th class="sortable" data-sort="top8">Top 8</th>
            <th class="sortable" data-sort="finals-week-2">Finals Week 2</th>
            <th class="sortable" data-sort="top4">Top 4</th>
            <th class="sortable" data-sort="prelim">Prelim</th>
            <th class="sortable" data-sort="grand-final">Grand Final</th>
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

function getRenderedTeams() {
  return Array.from(document.querySelectorAll('#simulation-tbody tr')).map((row) =>
    row.querySelector('td:nth-child(2) span').textContent
  );
}

describe('public/js/simulation.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalFetch;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(buildSimulationDom(), { url: 'https://example.test/simulation' });
    restoreDomGlobals = installDomGlobals(dom);
    makeWritableSelectValue(dom.window.document.getElementById('year-select'), '2026');

    originalFetch = global.fetch;
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
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
    consoleErrorSpy.mockRestore();
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
    expect(document.querySelector('#simulation-table th.sortable[data-sort="projected-wins"]').classList.contains('sorted-desc')).toBe(true);
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

    document.querySelector('#simulation-table th.sortable[data-sort="top10"]').click();

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
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading simulation data:', expect.any(Error));
  });

  test('infers the latest current snapshot and prunes stale current tabs when no explicit key is provided', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2026,
            round_snapshots: [
              {
                round_key: 'round-1',
                round_label: 'Before Round 1',
                round_tab_label: 'R1',
                round_order: 1,
                completed_matches: 0,
                remaining_matches: 207,
                num_simulations: 50000,
                results: [buildTeam('Cats')]
              },
              {
                round_key: 'round-1-current',
                round_label: 'Current Round 1',
                round_tab_label: 'Current',
                round_order: 1.5,
                completed_matches: 4,
                remaining_matches: 203,
                num_simulations: 50000,
                results: [buildTeam('Cats')]
              },
              {
                round_key: 'round-2',
                round_label: 'Before Round 2',
                round_tab_label: 'R2',
                round_order: 2,
                completed_matches: 9,
                remaining_matches: 198,
                num_simulations: 50000,
                results: [buildTeam('Cats')]
              },
              {
                round_key: 'round-2-current',
                round_label: 'Current Round 2',
                round_tab_label: 'Current',
                round_order: 2.5,
                completed_matches: 12,
                remaining_matches: 195,
                num_simulations: 50000,
                results: [buildTeam('Cats')]
              }
            ]
          })
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

    expect(document.querySelector('[data-round-key="round-1-current"]')).toBeNull();
    expect(document.querySelector('[data-round-key="round-2-current"]')).not.toBeNull();
    expect(document.querySelectorAll('#round-tabs .simulation-round-button')).toHaveLength(3);
    expect(document.getElementById('round-snapshot-context').textContent).toBe('Current Round 2');
    expect(document.querySelector('[data-round-key="round-2-current"]').classList.contains('selected')).toBe(true);
  });

  test('sorts by probability columns using fallback logic and hides ladder matrix when matrix data is unavailable', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026, 2025] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2026,
            round_snapshots: [
              {
                round_key: 'round-2-current',
                round_label: 'Current Round 2',
                round_tab_label: 'Current',
                round_order: 2.5,
                completed_matches: 12,
                remaining_matches: 195,
                num_simulations: 50000,
                results: [
                  buildTeam('Cats', {
                    projected_wins: 15.2,
                    top6_probability: 0.2,
                    finals_probability: 0.82,
                    finals_week2_probability: 0.55,
                    ladder_position_probabilities: { 1: 0.1, 2: 0.1 }
                  }),
                  buildTeam('Bombers', {
                    projected_wins: 14.7,
                    top6_probability: undefined,
                    finals_probability: 0.9,
                    wildcard_probability: 0.1,
                    finals_week2_probability: undefined,
                    ladder_position_probabilities: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.1, 5: 0.1, 6: 0.1 }
                  }),
                  buildTeam('Dockers', {
                    projected_wins: 13.4,
                    top6_probability: undefined,
                    finals_probability: 0.8,
                    wildcard_probability: 0.5,
                    finals_week2_probability: 0.25,
                    ladder_position_probabilities: undefined
                  })
                ]
              }
            ]
          })
        });
      }

      if (url === '/api/simulation/2025') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2025,
            current_round_label: 'Before Round 4',
            num_simulations: 50000,
            completed_matches: 24,
            remaining_matches: 183,
            results: [
              buildTeam('Cats', { ladder_position_probabilities: undefined }),
              buildTeam('Swans', { ladder_position_probabilities: undefined, projected_wins: 14.1 })
            ]
          })
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

    expect(getRenderedTeams()).toEqual(['Cats', 'Bombers', 'Dockers']);

    document.querySelector('#simulation-table th.sortable[data-sort="top6"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Dockers', 'Cats']);

    document.querySelector('#simulation-table th.sortable[data-sort="finals-week-2"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Cats', 'Dockers']);

    document.querySelector('#simulation-table th.sortable[data-sort="team"]').click();
    document.querySelector('#simulation-table th.sortable[data-sort="team"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Cats', 'Dockers']);

    const yearSelect = document.getElementById('year-select');
    yearSelect.value = '2025';
    yearSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector('#simulation-table th.sortable[data-sort="team"]').classList.contains('sorted-asc')).toBe(true);
    expect(document.getElementById('ladder-position-card').classList.contains('is-hidden')).toBe(true);
    expect(document.getElementById('round-snapshot-nav').classList.contains('is-hidden')).toBe(true);
  });

  test('supports the remaining sortable columns across 2026 and legacy seasons', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026, 2025] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2026,
            round_snapshots: [
              {
                round_key: 'round-2-current',
                round_label: 'Current Round 2',
                round_tab_label: 'Current',
                round_order: 2.5,
                completed_matches: 12,
                remaining_matches: 195,
                num_simulations: 50000,
                results: [
                  buildTeam('Cats', {
                    current_elo: 1510,
                    current_wins: 4,
                    projected_wins: 15.5,
                    finals_probability: 0.82,
                    wildcard_probability: 0.03,
                    top4_probability: 0.42,
                    prelim_probability: 0.21,
                    grand_final_probability: 0.11,
                    finals_week2_probability: 0.55
                  }),
                  buildTeam('Bombers', {
                    current_elo: 1490,
                    current_wins: 6,
                    projected_wins: 14.7,
                    finals_probability: 0.91,
                    wildcard_probability: 0.16,
                    top4_probability: 0.51,
                    prelim_probability: 0.29,
                    grand_final_probability: 0.17,
                    finals_week2_probability: 0.68
                  }),
                  buildTeam('Dockers', {
                    current_elo: 1525,
                    current_wins: 5,
                    projected_wins: 13.4,
                    finals_probability: 0.77,
                    wildcard_probability: 0.45,
                    top4_probability: 0.35,
                    prelim_probability: 0.18,
                    grand_final_probability: 0.08,
                    finals_week2_probability: 0.24
                  })
                ]
              }
            ]
          })
        });
      }

      if (url === '/api/simulation/2025') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2025,
            current_round_label: 'Before Round 4',
            num_simulations: 50000,
            completed_matches: 24,
            remaining_matches: 183,
            results: [
              buildTeam('Cats', { finals_probability: 0.72 }),
              buildTeam('Swans', { finals_probability: 0.91, projected_wins: 14.1 }),
              buildTeam('Dockers', { finals_probability: 0.65, projected_wins: 13.5 })
            ]
          })
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

    document.querySelector('#simulation-table th.sortable[data-sort="elo"]').click();
    expect(getRenderedTeams()).toEqual(['Dockers', 'Cats', 'Bombers']);

    document.querySelector('#simulation-table th.sortable[data-sort="record"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Dockers', 'Cats']);

    document.querySelector('#simulation-table th.sortable[data-sort="projected-wins"]').click();
    expect(getRenderedTeams()).toEqual(['Cats', 'Bombers', 'Dockers']);

    document.querySelector('#simulation-table th.sortable[data-sort="top10"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Cats', 'Dockers']);

    document.querySelector('#simulation-table th.sortable[data-sort="wildcard"]').click();
    expect(getRenderedTeams()).toEqual(['Dockers', 'Bombers', 'Cats']);

    document.querySelector('#simulation-table th.sortable[data-sort="top4"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Cats', 'Dockers']);

    document.querySelector('#simulation-table th.sortable[data-sort="prelim"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Cats', 'Dockers']);

    document.querySelector('#simulation-table th.sortable[data-sort="grand-final"]').click();
    expect(getRenderedTeams()).toEqual(['Bombers', 'Cats', 'Dockers']);

    const yearSelect = document.getElementById('year-select');
    yearSelect.value = '2025';
    yearSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    document.querySelector('#simulation-table th.sortable[data-sort="top8"]').click();
    expect(getRenderedTeams()).toEqual(['Swans', 'Cats', 'Dockers']);
  });

  test('keeps table order stable when an unknown sort header is clicked', async () => {
    const unknownHeader = document.createElement('th');
    unknownHeader.className = 'sortable';
    unknownHeader.dataset.sort = 'unknown-column';
    document.querySelector('#simulation-table thead tr').appendChild(unknownHeader);

    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026] })
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

    const initialTeams = getRenderedTeams();
    unknownHeader.click();

    expect(getRenderedTeams()).toEqual(initialTeams);
    expect(unknownHeader.classList.contains('sorted-desc')).toBe(true);
  });

  test('renders an empty snapshot row when round snapshots have no result entries', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2026,
            round_snapshots: [
              {
                round_key: 'broken',
                round_label: 'Broken Snapshot',
                results: null
              }
            ]
          })
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

    expect(document.getElementById('error-message').classList.contains('is-hidden')).toBe(true);
    expect(document.getElementById('round-snapshot-context').textContent).toBe('Broken Snapshot');
    expect(document.querySelectorAll('#simulation-tbody tr')).toHaveLength(0);
  });

  test('shows an error when snapshot payloads collapse to no usable snapshot entries', async () => {
    global.fetch.mockImplementation((url) => {
      if (url === '/api/simulation/years') {
        return Promise.resolve({
          json: async () => ({ success: true, years: [2026] })
        });
      }

      if (url === '/api/simulation/2026') {
        return Promise.resolve({
          json: async () => ({
            success: true,
            year: 2026,
            round_snapshots: [null]
          })
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

    expect(document.getElementById('error-message').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('error-text').textContent).toBe(
      'Simulation snapshot data is missing or invalid.'
    );
    expect(document.getElementById('table-container').classList.contains('is-hidden')).toBe(true);
  });
});
