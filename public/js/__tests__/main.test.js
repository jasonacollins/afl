const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

describe('public/js/main.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalAlert;
  let originalFetch;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <meta name="csrf-token" content="csrf-token-123">
      <div class="round-buttons">
        <button class="round-button" data-round="1">Round 1</button>
        <button class="round-button" data-round="2">Round 2</button>
      </div>
      <div id="matches-container"></div>
    `);
    restoreDomGlobals = installDomGlobals(dom);

    originalAlert = global.alert;
    originalFetch = global.fetch;

    global.alert = jest.fn();
    window.alert = global.alert;
    window.isAdmin = false;
    window.userPredictions = {
      22: {
        probability: 64,
        tippedTeam: 'home'
      }
    };
    global.calculateBrierScore = jest.fn(() => 0.2);
    global.calculateBitsScore = jest.fn(() => 0.4);
    global.calculateTipPoints = jest.fn(() => 1);
  });

  afterEach(() => {
    if (typeof originalAlert === 'undefined') {
      delete global.alert;
    } else {
      global.alert = originalAlert;
    }

    if (typeof originalFetch === 'undefined') {
      delete global.fetch;
      delete window.fetch;
    } else {
      global.fetch = originalFetch;
      window.fetch = originalFetch;
    }

    delete global.calculateBrierScore;
    delete global.calculateBitsScore;
    delete global.calculateTipPoints;

    restoreDomGlobals();
    dom.window.close();
  });

  test('fetchMatchesForRound updates selected state, renders matches, and refreshes round statuses', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/predictions/round/2?year=2026') {
        return Promise.resolve({
          json: async () => ([
            {
              match_id: 22,
              match_date: '2026-04-10T09:30:00.000Z',
              venue: 'MCG',
              home_team: 'Cats',
              home_team_abbrev: 'CAT',
              away_team: 'Swans',
              away_team_abbrev: 'SYD',
              hscore: null,
              ascore: null,
              isLocked: false
            }
          ])
        });
      }

      if (url === '/predictions/round/1?year=2026') {
        return Promise.resolve({
          json: async () => ([
            { match_id: 11, hscore: 90, ascore: 80 }
          ])
        });
      }

      return Promise.resolve({
        json: async () => ([
          { match_id: 22, hscore: null, ascore: null }
        ])
      });
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    window.fetchMatchesForRound('2');
    await flushPromises();
    await flushPromises();

    expect(document.querySelector('.round-button[data-round="2"]').classList.contains('selected')).toBe(true);
    expect(document.getElementById('matches-container').textContent).toContain('Cats');
    expect(document.getElementById('matches-container').textContent).toContain('Swans');
    expect(document.querySelector('.round-button[data-round="1"]').classList.contains('completed')).toBe(true);
    expect(document.querySelector('.round-button[data-round="2"]').classList.contains('has-predictions')).toBe(true);
  });

  test('savePrediction posts CSRF-protected JSON and updates stored prediction state', async () => {
    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="44" data-original-value="" value="50">
        <button class="save-prediction" data-match-id="44" data-tipped-team="away">Save Prediction</button>
      </div>
    `;

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true })
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('44', '50', button);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/predictions/save', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token-123'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      matchId: '44',
      probability: 50,
      tippedTeam: 'away'
    });
    expect(window.userPredictions['44']).toEqual({
      probability: 50,
      tippedTeam: 'away'
    });
    expect(button.textContent).toBe('Saved');
    expect(document.querySelector('.home-prediction').dataset.originalValue).toBe('50');
  });

  test('savePrediction refuses to post when the CSRF token is missing', () => {
    document.querySelector('meta[name="csrf-token"]').remove();
    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="44" data-original-value="" value="61">
        <button class="save-prediction" data-match-id="44">Save Prediction</button>
      </div>
    `;

    global.fetch = jest.fn();
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('44', '61', button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Security token missing. Please refresh the page and try again.');
    expect(button.textContent).toBe('Save Prediction');
    expect(button.disabled).toBe(false);
  });
});
