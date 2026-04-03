const {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
} = require('./browser-test-utils');

describe('public/js/admin.js', () => {
  let dom;
  let restoreDomGlobals;
  let originalAlert;
  let originalFetch;
  let originalSetTimeout;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <meta name="csrf-token" content="admin-csrf-token">
      <input id="selected-user-id" value="7">
      <div class="user-buttons"></div>
      <div id="resetPasswordModal"></div>
      <div id="refreshApiModal"></div>
      <div id="uploadDatabaseModal"></div>
      <div id="deleteUserModal"></div>
      <table>
        <tbody>
          <tr class="inactive-predictor">
            <td>
              <button class="toggle-active" data-active="false">Inactive</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="match-card">
        <div class="prediction-controls">
          <button class="save-prediction" data-match-id="44">Save Prediction</button>
        </div>
        <input class="home-prediction" data-match-id="44" data-original-value="61" value="61">
        <input class="away-prediction" data-match-id="44" value="39">
        <div class="admin-metrics-display">Old metrics</div>
      </div>
    `, { url: 'https://example.test/admin?year=2026' });
    restoreDomGlobals = installDomGlobals(dom);

    originalAlert = global.alert;
    originalFetch = global.fetch;
    originalSetTimeout = global.setTimeout;

    global.alert = jest.fn();
    window.alert = global.alert;
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.setTimeout = jest.fn((callback) => {
      callback();
      return 0;
    });
    window.setTimeout = global.setTimeout;
    global.updateStoredPrediction = jest.fn();
    global.getMatchDataById = jest.fn(() => null);
    global.calculateAccuracy = jest.fn(() => '<p>metrics</p>');
    window.fetchMatchesForRound = jest.fn();
    window.savePrediction = jest.fn();
    window.location.reload = jest.fn();
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

    global.setTimeout = originalSetTimeout;
    window.setTimeout = originalSetTimeout;

    delete global.updateStoredPrediction;
    delete global.getMatchDataById;
    delete global.calculateAccuracy;

    restoreDomGlobals();
    dom.window.close();
  });

  test('toggleActiveStatus posts a CSRF-protected request and updates the row state on success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });

    loadBrowserScript('admin.js');

    const button = document.querySelector('.toggle-active');
    window.toggleActiveStatus('12', true, button);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/admin/api/predictors/12/toggle-active', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'admin-csrf-token'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ active: true });
    expect(button.textContent).toBe('Active');
    expect(button.dataset.active).toBe('true');
    expect(button.closest('tr').classList.contains('inactive-predictor')).toBe(false);
  });

  test('toggleActiveStatus restores button state and alerts when the server rejects the change', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: 'No permission' })
    });

    loadBrowserScript('admin.js');

    const button = document.querySelector('.toggle-active');
    window.toggleActiveStatus('12', true, button);
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('Error updating predictor status: No permission');
    expect(button.textContent).toBe('Inactive');
    expect(button.disabled).toBe(false);
    expect(button.closest('tr').classList.contains('inactive-predictor')).toBe(true);
  });

  test('clearPredictionDirectly clears inputs and posts the admin save request with CSRF protection', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });

    loadBrowserScript('admin.js');

    const button = document.querySelector('.save-prediction');
    window.clearPredictionDirectly('44', '7', button);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/7/save', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': 'admin-csrf-token'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      matchId: '44',
      probability: ''
    });
    expect(document.querySelector('.home-prediction').value).toBe('');
    expect(document.querySelector('.away-prediction').value).toBe('');
    expect(document.querySelector('.admin-metrics-display').innerHTML).toBe('');
    expect(global.updateStoredPrediction).toHaveBeenCalledWith('44', null, null);
  });

  test('clearPredictionDirectly requires a selected user', () => {
    loadBrowserScript('admin.js');

    const button = document.querySelector('.save-prediction');
    window.clearPredictionDirectly('44', '', button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Please select a user first');
  });

  test('admin savePrediction override posts the selected user prediction and refreshes metrics', async () => {
    global.getMatchDataById = jest.fn(() => ({
      match_id: 44,
      hscore: 88,
      ascore: 80
    }));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const button = document.querySelector('.save-prediction');
    button.dataset.tippedTeam = 'away';

    window.savePrediction('44', '50', button);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/admin/predictions/7/save', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CSRF-Token': 'admin-csrf-token'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      matchId: '44',
      probability: 50,
      tippedTeam: 'away'
    });
    expect(global.updateStoredPrediction).toHaveBeenCalledWith('44', 50, 'away');
    expect(document.querySelector('.home-prediction').dataset.originalValue).toBe('50');
    expect(document.querySelector('.admin-metrics-display').innerHTML).toBe('<p>metrics</p>');
  });

  test('DOMContentLoaded adds clear buttons that route through savePrediction with an empty payload', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const saveButton = document.querySelector('.save-prediction');
    const clearButton = document.querySelector('.clear-prediction');
    window.savePrediction = jest.fn();

    clearButton.click();

    expect(window.savePrediction).toHaveBeenCalledWith('44', '', saveButton);
  });
});
