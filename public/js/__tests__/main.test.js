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
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <meta name="csrf-token" content="csrf-token-123">
      <div id="selected-user"></div>
      <input id="selected-user-id" value="">
      <div class="user-buttons">
        <button class="user-button" data-user-id="7">Selected User</button>
      </div>
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
    window.canOverridePredictionLocks = false;
    window.userPredictions = {
      22: {
        probability: 64,
        tippedTeam: 'home'
      }
    };
    global.calculateBrierScore = jest.fn(() => 0.2);
    global.calculateBitsScore = jest.fn(() => 0.4);
    global.calculateTipPoints = jest.fn(() => 1);
    window.calculateBrierScore = global.calculateBrierScore;
    window.calculateBitsScore = global.calculateBitsScore;
    window.calculateTipPoints = global.calculateTipPoints;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ([])
    });
    window.fetch = global.fetch;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
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
    delete window.calculateBrierScore;
    delete window.calculateBitsScore;
    delete window.calculateTipPoints;
    delete window.getMatchesForRoundData;
    delete window.onMatchesRendered;
    consoleErrorSpy.mockRestore();

    restoreDomGlobals();
    dom.window.close();
  });

  test('bootstraps on DOMContentLoaded by formatting dates, wiring round clicks, and initializing save buttons', async () => {
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <div class="match-date">2026-04-10T09:30:00.000Z</div>
        <input class="home-prediction" data-match-id="88" data-original-value="" value="61">
        <input class="away-prediction" data-match-id="88" value="39">
        <button class="save-prediction" data-match-id="88">Save Prediction</button>
      </div>
    `;

    global.fetch = jest.fn((url) => {
      if (url === '/predictions/round/2?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              match_id: 99,
              match_date: '2026-04-12T09:30:00.000Z',
              venue: 'MCG',
              home_team: 'Cats',
              away_team: 'Swans',
              hscore: null,
              ascore: null,
              isLocked: false
            }
          ])
        });
      }

      if (url === '/predictions/round/1?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([])
        });
      }

      if (url === '/predictions/save') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true })
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ([])
      });
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.match-date').dataset.originalDate).toBe('2026-04-10T09:30:00.000Z');
    expect(document.querySelector('.match-date').textContent).not.toBe('2026-04-10T09:30:00.000Z');

    const initialSaveButton = document.querySelector('.save-prediction[data-match-id="88"]');
    const initialHomeInput = document.querySelector('.home-prediction[data-match-id="88"]');
    initialHomeInput.value = '63';
    initialSaveButton.click();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/predictions/save', expect.any(Object));

    document.querySelector('.round-button[data-round="2"]').click();
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/predictions/round/2?year=2026', { cache: 'no-store' });
  });

  test('fetchMatchesForRound updates selected state, renders matches, and refreshes round statuses', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/predictions/round/2?year=2026') {
        return Promise.resolve({
          ok: true,
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
          ok: true,
          json: async () => ([
            { match_id: 11, hscore: 90, ascore: 80 }
          ])
        });
      }

      return Promise.resolve({
        ok: true,
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
    expect(document.querySelector('#matches-container .match-card')).not.toBeNull();
    expect(document.querySelector('.round-button[data-round="1"]').classList.contains('completed')).toBe(true);
    expect(document.querySelector('.round-button[data-round="2"]').classList.contains('has-predictions')).toBe(true);
  });

  test('renderMatches preserves 0 percent probabilities and snake_case tipped teams from stored predictions', () => {
    window.userPredictions = {
      22: {
        probability: 0,
        tipped_team: 'away'
      }
    };

    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: null,
        ascore: null,
        isLocked: false
      }
    ]);

    expect(document.querySelector('.home-prediction[data-match-id="22"]').value).toBe('0');
    expect(document.querySelector('.away-prediction[data-match-id="22"]').value).toBe('100');
    expect(document.querySelector('.save-prediction[data-match-id="22"]').textContent.trim()).toBe('Saved');
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
      ok: true,
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

  test('prediction inputs manage 50 percent team selection and delete state transitions', () => {
    loadBrowserScript('main.js');

    window.renderMatches([
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
    ]);

    const homeInput = document.querySelector('.home-prediction[data-match-id="22"]');
    const awayInput = document.querySelector('.away-prediction[data-match-id="22"]');
    const saveButton = document.querySelector('.save-prediction[data-match-id="22"]');

    homeInput.value = '50';
    homeInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(awayInput.value).toBe('50');
    expect(saveButton.textContent).toBe('Update Prediction');
    expect(document.getElementById('team-selection-22')).not.toBeNull();
    expect(saveButton.dataset.tippedTeam).toBe('home');

    document.querySelector('#team-selection-22 .away-team-button').click();
    expect(saveButton.dataset.tippedTeam).toBe('away');

    homeInput.value = '';
    homeInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(awayInput.value).toBe('');
    expect(saveButton.textContent).toBe('Clear Prediction');
    expect(saveButton.classList.contains('delete-state')).toBe(true);
    expect(document.getElementById('team-selection-22')).toBeNull();
  });

  test('save button blocks 50 percent submissions until a team selection is present', () => {
    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: null,
        ascore: null,
        isLocked: false
      }
    ]);

    const homeInput = document.querySelector('.home-prediction[data-match-id="22"]');
    const saveButton = document.querySelector('.save-prediction[data-match-id="22"]');

    homeInput.value = '50';
    homeInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    delete saveButton.dataset.tippedTeam;

    saveButton.click();

    expect(global.alert).toHaveBeenCalledWith('Please select which team you think will win');
  });

  test('savePrediction defaults 50 percent submissions to a home-team tip when no tiebreaker is selected', async () => {
    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="44" data-original-value="" value="50">
        <button class="save-prediction" data-match-id="44">Save Prediction</button>
      </div>
    `;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('44', '50', button);
    await flushPromises();

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      matchId: '44',
      probability: 50,
      tippedTeam: 'home'
    });
  });

  test('renderMatches shows partial draw accuracy for non-50 admin tips', () => {
    window.isAdmin = true;
    window.userPredictions = {
      22: {
        probability: 70,
        tippedTeam: 'home'
      }
    };
    global.calculateTipPoints = jest.fn(() => 0.5);
    window.calculateTipPoints = global.calculateTipPoints;

    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: 80,
        ascore: 80,
        isLocked: false
      }
    ]);

    expect(document.querySelector('.admin-metrics-display').innerHTML).toContain('partial');
    expect(global.calculateTipPoints).toHaveBeenCalledWith(70, 80, 80, 'home');
  });

  test('renderMatches keeps started matches locked when only the predictor-page admin flag is set', () => {
    window.isAdmin = true;
    window.userPredictions = {
      22: {
        probability: 64,
        tippedTeam: 'home'
      }
    };

    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: null,
        ascore: null,
        isLocked: true
      }
    ]);

    expect(document.querySelector('.prediction-controls')).toBeNull();
    expect(document.querySelector('.prediction-locked')).not.toBeNull();
    expect(document.getElementById('matches-container').textContent).toContain('Match has started - predictions locked');
  });

  test('renderMatches allows editing locked matches when the admin override page enables it', () => {
    window.isAdmin = true;
    window.canOverridePredictionLocks = true;
    window.userPredictions = {
      22: {
        probability: 64,
        tippedTeam: 'home'
      }
    };

    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: null,
        ascore: null,
        isLocked: true
      }
    ]);

    expect(document.querySelector('.prediction-controls')).not.toBeNull();
    expect(document.querySelector('.prediction-locked')).toBeNull();
  });

  test('renderMatches shows locked match details, pending lock messaging, and GWS abbreviations', () => {
    window.userPredictions = {
      22: {
        probability: 50,
        tippedTeam: 'away'
      }
    };

    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'ENGIE Stadium',
        home_team: 'Greater Western Sydney',
        home_team_abbrev: 'GWS',
        away_team: 'Swans',
        away_team_abbrev: 'SYD',
        hscore: null,
        ascore: null,
        isLocked: true
      }
    ]);

    const matchText = document.getElementById('matches-container').textContent;
    expect(matchText).toContain('Your prediction: 50% for GWS');
    expect(matchText).toContain('Tipped: Swans to win');
    expect(matchText).toContain('Match has started - predictions locked');
  });

  test('renderMatches shows an empty state when a round has no fixtures', () => {
    loadBrowserScript('main.js');

    window.renderMatches([]);

    expect(document.getElementById('matches-container').textContent).toContain('No matches available for this round');
  });

  test('updateRoundButtonStates marks unfinished rounds needing predictions and tolerates fetch failures', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn((url) => {
      if (url === '/predictions/round/1?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            { match_id: 11, hscore: null, ascore: null }
          ])
        });
      }

      if (url === '/predictions/round/2?year=2026') {
        return Promise.reject(new Error('round state failed'));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    window.updateRoundButtonStates();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector('.round-button[data-round="1"]').classList.contains('needs-predictions')).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith('Error checking round state:', expect.any(Error));

    errorSpy.mockRestore();
  });

  test('selectUser refreshes admin predictions and re-renders the selected round when matches are visible', async () => {
    window.location.pathname = '/admin/user-predictions';
    document.querySelector('.round-buttons').innerHTML = `
      <button class="round-button selected" data-round="2">Round 2</button>
    `;
    document.getElementById('matches-container').innerHTML = '<div class="match-card">Existing match</div>';

    global.fetch = jest.fn((url) => {
      if (url === '/admin/predictions/7') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            predictions: {
              22: {
                probability: 58,
                tippedTeam: 'away'
              }
            }
          })
        });
      }

      if (url === '/admin/predictions/9/round/2?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              match_id: 22,
              match_date: '2026-04-10T09:30:00.000Z',
              venue: 'MCG',
              home_team: 'Cats',
              away_team: 'Swans',
              hscore: null,
              ascore: null,
              isLocked: false
            }
          ])
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    window.selectUser('7', 'Selected User');
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/admin/predictions/7', { cache: 'no-store' });
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/admin/predictions/7/round/2?year=2026', { cache: 'no-store' });
    expect(window.userPredictions).toEqual({
      22: {
        probability: 58,
        tippedTeam: 'away'
      }
    });
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/7/round/2?year=2026', { cache: 'no-store' });
  });

  test('savePrediction clears existing stored predictions on delete success', async () => {
    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="22" data-original-value="64" value="">
        <button class="save-prediction delete-state" data-match-id="22">Clear Prediction</button>
      </div>
    `;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('22', '', button);
    await flushPromises();
    await flushPromises();

    expect(window.userPredictions['22']).toBeUndefined();
    expect(document.querySelector('.home-prediction').dataset.originalValue).toBe('');
    expect(button.textContent).toBe('Cleared');
  });

  test('savePrediction restores the original button state when the server rejects the save', async () => {
    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="22" data-original-value="64" value="70">
        <button class="save-prediction" data-match-id="22">Update Prediction</button>
      </div>
    `;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Save rejected' })
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('22', '70', button);
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('Save rejected');
    expect(button.textContent).toBe('Update Prediction');
    expect(button.disabled).toBe(false);
  });

  test('savePrediction shows a generic alert when the request throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="22" data-original-value="64" value="70">
        <button class="save-prediction" data-match-id="22">Update Prediction</button>
      </div>
    `;

    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('22', '70', button);
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('An error occurred. Please try again.');
    expect(button.textContent).toBe('Update Prediction');
    expect(button.disabled).toBe(false);

    errorSpy.mockRestore();
  });

  test('fetchMatchesForRound shows an error state when the request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    window.fetchMatchesForRound('2');
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('matches-container').textContent).toContain('Failed to load matches');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching matches:', expect.any(Error));
  });

  test('fetchMatchesForRound shows render-time errors from post-fetch processing', async () => {
    window.getMatchesForRoundData = jest.fn().mockResolvedValue([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: null,
        ascore: null,
        isLocked: false
      }
    ]);
    window.onMatchesRendered = jest.fn(() => {
      throw new Error('render hook failed');
    });

    loadBrowserScript('main.js');

    window.fetchMatchesForRound('2');
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('matches-container').textContent).toContain('Failed to load matches');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching matches:', expect.any(Error));
  });

  test('fetchMatchesForRound uses the injected round-data loader when provided', async () => {
    window.getMatchesForRoundData = jest.fn().mockResolvedValue([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: null,
        ascore: null,
        isLocked: false
      }
    ]);

    loadBrowserScript('main.js');

    window.fetchMatchesForRound('2');
    await flushPromises();
    await flushPromises();

    expect(window.getMatchesForRoundData).toHaveBeenCalledWith('2', '2026');
    expect(document.getElementById('matches-container').textContent).toContain('Cats');
  });

  test('renderMatches prefers server-provided admin metrics for completed matches', () => {
    window.isAdmin = true;
    window.userPredictions = {
      22: {
        probability: 64,
        tippedTeam: 'home'
      }
    };
    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 22,
        match_date: '2026-04-10T09:30:00.000Z',
        venue: 'MCG',
        home_team: 'Cats',
        away_team: 'Swans',
        hscore: 80,
        ascore: 70,
        isLocked: false,
        adminMetrics: {
          tipPoints: 1,
          tipClass: 'correct',
          brierScore: '0.1234',
          bitsScore: '0.5678'
        }
      }
    ]);

    expect(document.querySelector('.admin-metrics-display').textContent).toContain('Tip: 1 | Brier: 0.1234 | Bits: 0.5678');
  });

  test('blur auto-saves an initial valid prediction and defaults 50 percent to the home team', async () => {
    document.querySelector('.round-buttons').innerHTML = '';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    window.renderMatches([
      {
        match_id: 30,
        match_date: '2026-04-12T09:30:00.000Z',
        venue: 'SCG',
        home_team: 'Swans',
        away_team: 'Cats',
        hscore: null,
        ascore: null,
        isLocked: false
      }
    ]);

    const input = document.querySelector('.home-prediction[data-match-id="30"]');
    const button = document.querySelector('.save-prediction[data-match-id="30"]');

    input.value = '50';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('blur', { bubbles: true }));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/predictions/save', expect.any(Object));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      matchId: '30',
      probability: 50,
      tippedTeam: 'home'
    });
    expect(button.textContent).toBe('Saved');
  });

  test('savePrediction restores the original value when the probability is invalid', () => {
    document.querySelector('.round-buttons').innerHTML = '';
    document.getElementById('matches-container').innerHTML = `
      <div class="match-card">
        <input class="home-prediction" data-match-id="44" data-original-value="61" value="abc">
        <input class="away-prediction" data-match-id="44" value="39">
        <button class="save-prediction" data-match-id="44">Update Prediction</button>
      </div>
    `;

    global.fetch = jest.fn();
    window.fetch = global.fetch;

    loadBrowserScript('main.js');

    const button = document.querySelector('.save-prediction');
    window.savePrediction('44', 'abc', button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Prediction must be a number between 0 and 100, or empty to clear.');
    expect(document.querySelector('.home-prediction').value).toBe('61');
    expect(button.textContent).toBe('Update Prediction');
    expect(button.disabled).toBe(false);
  });

  test('selectUser refreshes admin predictions and reloads the active round', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/admin/predictions/9') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            predictions: {
              55: { probability: 72, tippedTeam: 'home' }
            }
          })
        });
      }

      if (url === '/predictions/round/2?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              match_id: 55,
              match_date: '2026-04-14T09:30:00.000Z',
              venue: 'MCG',
              home_team: 'Cats',
              away_team: 'Swans',
              hscore: null,
              ascore: null,
              isLocked: false
            }
          ])
        });
      }

      if (url === '/predictions/round/1?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([])
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ([
          { match_id: 55, hscore: null, ascore: null }
        ])
      });
    });
    window.fetch = global.fetch;
    window.location.pathname = '/admin/user-predictions';

    loadBrowserScript('main.js');
    document.querySelector('.round-button[data-round="2"]').classList.add('selected');
    document.getElementById('matches-container').innerHTML = '<div class="match-card"></div>';

    window.selectUser('9', 'Analyst');
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('selected-user').textContent).toBe('Analyst');
    expect(document.getElementById('selected-user-id').value).toBe('9');
    expect(window.userPredictions).toEqual({
      55: { probability: 72, tippedTeam: 'home' }
    });
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/9', { cache: 'no-store' });
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/9/round/2?year=2026', { cache: 'no-store' });
  });

  test('selectUser logs fetch failures without mutating the current predictions state', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn().mockRejectedValue(new Error('user predictions down'));
    window.fetch = global.fetch;
    window.location.pathname = '/admin/user-predictions';

    loadBrowserScript('main.js');

    const initialPredictions = window.userPredictions;
    window.selectUser('9', 'Analyst');
    await flushPromises();

    expect(document.getElementById('selected-user').textContent).toBe('Analyst');
    expect(document.getElementById('selected-user-id').value).toBe('9');
    expect(window.userPredictions).toBe(initialPredictions);
    expect(errorSpy).toHaveBeenCalledWith('Error fetching user predictions:', expect.any(Error));

    errorSpy.mockRestore();
  });

  test('selectUser loads the first round on admin pages when no round is selected yet', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/admin/predictions/9') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            predictions: {
              55: { probability: 72, tippedTeam: 'home' }
            }
          })
        });
      }

      if (url === '/admin/predictions/9/round/1?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              match_id: 55,
              match_date: '2026-04-14T09:30:00.000Z',
              venue: 'MCG',
              home_team: 'Cats',
              away_team: 'Swans',
              hscore: null,
              ascore: null,
              isLocked: false
            }
          ])
        });
      }

      if (url === '/admin/predictions/9/round/2?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([])
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ([
          { match_id: 55, hscore: null, ascore: null }
        ])
      });
    });
    window.fetch = global.fetch;
    window.location.pathname = '/admin/user-predictions';

    loadBrowserScript('main.js');
    document.getElementById('matches-container').innerHTML = '<div class="match-card"></div>';

    window.selectUser('9', 'Analyst');
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('selected-user').textContent).toBe('Analyst');
    expect(document.getElementById('selected-user-id').value).toBe('9');
    expect(window.userPredictions).toEqual({
      55: { probability: 72, tippedTeam: 'home' }
    });
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/9', { cache: 'no-store' });
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/9/round/1?year=2026', { cache: 'no-store' });
  });

  test('admin user buttons bootstrap selection from main.js without relying on admin.js listeners', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/admin/predictions/7') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            predictions: {
              55: { probability: 72, tippedTeam: 'home' }
            }
          })
        });
      }

      if (url === '/admin/predictions/7/round/1?year=2026') {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              match_id: 55,
              match_date: '2026-04-14T09:30:00.000Z',
              venue: 'MCG',
              home_team: 'Cats',
              away_team: 'Swans',
              hscore: null,
              ascore: null,
              isLocked: false
            }
          ])
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ([])
      });
    });
    window.fetch = global.fetch;
    window.location.pathname = '/admin/user-predictions';

    loadBrowserScript('main.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.user-button').click();
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('selected-user').textContent).toBe('Selected User');
    expect(document.getElementById('selected-user-id').value).toBe('7');
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/7', { cache: 'no-store' });
    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/7/round/1?year=2026', { cache: 'no-store' });
  });

  test('formatDateToLocalTimezone falls back to the original string for invalid dates', () => {
    loadBrowserScript('main.js');

    expect(window.formatDateToLocalTimezone('not-a-real-date')).toBe('not-a-real-date');
    expect(window.formatDateToLocalTimezone('')).toBe('');
  });
});
