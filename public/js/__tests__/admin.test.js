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
  let originalFormData;
  let consoleErrorSpy;

  function setInputFiles(input, files) {
    Object.defineProperty(input, 'files', {
      value: files,
      configurable: true
    });
  }

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <meta name="csrf-token" content="admin-csrf-token">
      <input id="selected-user-id" value="7">
      <div id="selected-user"></div>
      <div class="user-buttons">
        <button class="user-button" data-user-id="7" data-display-name="Selected User">Selected User</button>
      </div>
      <div id="resetPasswordModal" style="display:none">
        <span id="resetUserName"></span>
        <form id="resetPasswordForm"></form>
        <input id="newPassword" value="existing">
      </div>
      <div id="refreshApiModal" style="display:none"></div>
      <div id="uploadDatabaseModal" style="display:none"></div>
      <div id="deleteUserModal" style="display:none">
        <span id="deleteUserName"></span>
        <form id="deleteUserForm"></form>
      </div>
      <button id="refreshApiButton">Refresh API</button>
      <form id="refreshApiForm">
        <input id="refreshYear" value="2026">
        <input id="forceScoreUpdate" type="checkbox">
        <div id="refreshStatus"></div>
        <button type="submit">Run Refresh</button>
      </form>
      <button id="uploadDatabaseButton">Upload DB</button>
      <form id="uploadDatabaseForm">
        <input id="databaseFile" type="file">
        <div id="uploadStatus"></div>
        <button type="submit">Upload</button>
      </form>
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
    originalFormData = global.FormData;

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
    global.FormData = class MockFormData {
      constructor() {
        this.entries = [];
      }

      append(key, value) {
        this.entries.push([key, value]);
      }
    };
    window.FormData = global.FormData;
    window.fetchMatchesForRound = jest.fn();
    window.savePrediction = jest.fn();
    window.location.reload = jest.fn();
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

    global.setTimeout = originalSetTimeout;
    window.setTimeout = originalSetTimeout;

    if (typeof originalFormData === 'undefined') {
      delete global.FormData;
      delete window.FormData;
    } else {
      global.FormData = originalFormData;
      window.FormData = originalFormData;
    }

    delete global.updateStoredPrediction;
    delete global.getMatchDataById;
    delete global.calculateAccuracy;
    consoleErrorSpy.mockRestore();

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

  test('toggleActiveStatus surfaces HTTP errors from the server response body', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Maintenance window'
    });

    loadBrowserScript('admin.js');

    const button = document.querySelector('.toggle-active');
    window.toggleActiveStatus('12', true, button);
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('Error updating predictor status: HTTP 503: Maintenance window');
    expect(button.textContent).toBe('Inactive');
    expect(button.disabled).toBe(false);
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

  test('admin script initialization enables lock overrides for managed predictor edits', () => {
    loadBrowserScript('admin.js');

    expect(window.isAdmin).toBe(true);
    expect(window.canOverridePredictionLocks).toBe(true);
  });

  test('clearPredictionDirectly requires a selected user', () => {
    loadBrowserScript('admin.js');

    const button = document.querySelector('.save-prediction');
    window.clearPredictionDirectly('44', '', button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Please select a user first');
  });

  test('clearPredictionDirectly restores the original button state when the server rejects the clear request', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Clear blocked' })
    });

    loadBrowserScript('admin.js');

    const button = document.querySelector('.save-prediction');
    window.clearPredictionDirectly('44', '7', button);
    await flushPromises();

    expect(button.textContent).toBe('Save Prediction');
    expect(button.disabled).toBe(false);
    expect(document.querySelector('.admin-metrics-display').innerHTML).toBe('Old metrics');
  });

  test('clearPredictionDirectly restores the button after network failures', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    loadBrowserScript('admin.js');

    const button = document.querySelector('.save-prediction');
    window.clearPredictionDirectly('44', '7', button);
    await flushPromises();

    expect(button.textContent).toBe('Save Prediction');
    expect(button.disabled).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error clearing prediction:',
      expect.any(Error)
    );
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

  test('refresh API form includes forceScoreUpdate and renders skipped game details', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Refresh completed',
        skippedGames: ['Cats vs Swans', 'Lions vs Dockers']
      })
    });

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.getElementById('forceScoreUpdate').checked = true;
    document.getElementById('refreshApiForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true
    }));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/admin/api-refresh', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CSRF-Token': 'admin-csrf-token'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      year: '2026',
      forceScoreUpdate: true
    });
    expect(document.getElementById('refreshStatus').textContent).toContain('Refresh completed');
    expect(document.getElementById('refreshStatus').textContent).toContain('Skipped Games');
    expect(document.getElementById('refreshStatus').textContent).toContain('Cats vs Swans');
    expect(document.querySelector('#refreshApiForm button[type="submit"]').disabled).toBe(false);
  });

  test('upload form blocks submission when no database file is selected', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    setInputFiles(document.getElementById('databaseFile'), []);

    document.getElementById('uploadDatabaseForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true
    }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('uploadStatus').textContent).toContain('Please select a database file.');
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

  test('admin fetchMatchesForRound wrapper preserves the original loader and re-applies clear buttons', () => {
    const originalFetchMatchesForRound = window.fetchMatchesForRound;

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.clear-prediction').remove();
    window.fetchMatchesForRound('2');

    expect(originalFetchMatchesForRound).toHaveBeenCalledWith('2');
    expect(document.querySelector('.clear-prediction')).not.toBeNull();
  });

  test('admin savePrediction rejects invalid probabilities and restores the saved value', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const input = document.querySelector('.home-prediction');
    const button = document.querySelector('.save-prediction');

    input.value = '120';
    button.textContent = 'Saving...';
    button.disabled = true;

    window.savePrediction('44', '120', button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Prediction must be a number between 0 and 100.');
    expect(input.value).toBe('61');
    expect(button.textContent).toBe('Update Prediction');
    expect(button.disabled).toBe(false);
  });

  test('admin savePrediction requires a selected user before posting', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.getElementById('selected-user-id').value = '';
    const button = document.querySelector('.save-prediction');

    window.savePrediction('44', '61', button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Please select a user first');
    expect(button.disabled).toBe(false);
  });

  test('admin savePrediction restores the original button state when the save is rejected', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Save denied' })
    });

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const input = document.querySelector('.home-prediction');
    const button = document.querySelector('.save-prediction');

    input.value = '62';
    button.textContent = 'Update Prediction';

    window.savePrediction('44', '62', button);
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('Save denied');
    expect(button.textContent).toBe('Update Prediction');
    expect(button.disabled).toBe(false);
    expect(input.dataset.originalValue).toBe('61');
  });

  test('admin savePrediction restores the button and alerts on network failures', async () => {
    global.fetch.mockRejectedValue(new Error('save request failed'));

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const input = document.querySelector('.home-prediction');
    const button = document.querySelector('.save-prediction');

    input.value = '62';
    button.textContent = 'Update Prediction';

    window.savePrediction('44', '62', button);
    await flushPromises();

    expect(global.alert).toHaveBeenCalledWith('An error occurred. Please try again.');
    expect(button.textContent).toBe('Update Prediction');
    expect(button.disabled).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error saving prediction:',
      expect.any(Error)
    );
  });

  test('admin savePrediction clears metrics when match results are unavailable', async () => {
    global.getMatchDataById = jest.fn(() => null);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const button = document.querySelector('.save-prediction');
    window.savePrediction('44', '62', button);
    await flushPromises();

    expect(document.querySelector('.admin-metrics-display').innerHTML).toBe('');
  });

  test('refresh form submits API refresh options and renders skipped games', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Refresh complete',
        skippedGames: ['Game A', 'Game B']
      })
    });

    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.getElementById('forceScoreUpdate').checked = true;
    document.getElementById('refreshApiForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/admin/api-refresh', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CSRF-Token': 'admin-csrf-token'
      })
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      year: '2026',
      forceScoreUpdate: true
    });
    expect(document.getElementById('refreshStatus').innerHTML).toContain('Refresh complete');
    expect(document.getElementById('refreshStatus').innerHTML).toContain('Skipped Games');
  });

  test('upload form requires a database file and reloads after a successful upload', async () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const fileInput = document.getElementById('databaseFile');
    setInputFiles(fileInput, []);

    document.getElementById('uploadDatabaseForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    expect(document.getElementById('uploadStatus').innerHTML).toContain('Please select a database file.');

    const mockFile = { name: 'afl_predictions.db' };
    setInputFiles(fileInput, [mockFile]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Upload complete' })
    });

    document.getElementById('uploadDatabaseForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const [, requestOptions] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/admin/upload-database', expect.objectContaining({
      method: 'POST',
      headers: { Accept: 'application/json' }
    }));
    expect(requestOptions.body.entries).toEqual([
      ['databaseFile', mockFile],
      ['_csrf', 'admin-csrf-token']
    ]);
    expect(document.getElementById('uploadStatus').innerHTML).toContain('Upload complete');
    expect(window.location.reload).toHaveBeenCalled();
  });

  test('refresh form and upload form re-enable their submit buttons after failure responses', async () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, message: 'Refresh blocked' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, message: 'Upload blocked' })
      });

    const refreshForm = document.getElementById('refreshApiForm');
    const refreshSubmit = refreshForm.querySelector('button[type="submit"]');
    refreshForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById('refreshStatus').innerHTML).toContain('Refresh blocked');
    expect(refreshSubmit.disabled).toBe(false);

    const fileInput = document.getElementById('databaseFile');
    setInputFiles(fileInput, [{ name: 'afl_predictions.db' }]);

    const uploadForm = document.getElementById('uploadDatabaseForm');
    const uploadSubmit = uploadForm.querySelector('button[type="submit"]');
    uploadForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById('uploadStatus').innerHTML).toContain('Upload blocked');
    expect(uploadSubmit.disabled).toBe(false);
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  test('modal helper functions and delegated actions update the modal state', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    window.showResetPasswordForm('12', 'Alice');
    expect(document.getElementById('resetUserName').textContent).toBe('Alice');
    expect(document.getElementById('resetPasswordForm').action).toContain('/admin/reset-password/12');
    expect(document.getElementById('resetPasswordModal').style.display).toBe('block');

    window.confirmDeleteUser('21', 'Bob');
    expect(document.getElementById('deleteUserName').textContent).toBe('Bob');
    expect(document.getElementById('deleteUserForm').action).toContain('/admin/delete-user/21');
    expect(document.getElementById('deleteUserModal').style.display).toBe('block');

    const delegatedButton = document.createElement('button');
    delegatedButton.dataset.action = 'show-reset-password';
    delegatedButton.dataset.userId = '33';
    delegatedButton.dataset.userName = 'Carol';
    document.body.appendChild(delegatedButton);
    delegatedButton.click();

    expect(document.getElementById('resetUserName').textContent).toBe('Carol');

    window.onclick({ target: document.getElementById('deleteUserModal') });
    expect(document.getElementById('deleteUserModal').style.display).toBe('none');
  });

  test('button click handlers open refresh and upload modals, and outside clicks close each modal type', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.getElementById('refreshApiButton').click();
    document.getElementById('uploadDatabaseButton').click();
    window.showResetPasswordForm('12', 'Alice');
    window.confirmDeleteUser('21', 'Bob');

    expect(document.getElementById('refreshApiModal').style.display).toBe('block');
    expect(document.getElementById('uploadDatabaseModal').style.display).toBe('block');
    expect(document.getElementById('resetPasswordModal').style.display).toBe('block');
    expect(document.getElementById('deleteUserModal').style.display).toBe('block');

    window.onclick({ target: document.getElementById('refreshApiModal') });
    window.onclick({ target: document.getElementById('uploadDatabaseModal') });
    window.onclick({ target: document.getElementById('resetPasswordModal') });
    window.onclick({ target: document.getElementById('deleteUserModal') });

    expect(document.getElementById('refreshApiModal').style.display).toBe('none');
    expect(document.getElementById('uploadDatabaseModal').style.display).toBe('none');
    expect(document.getElementById('resetPasswordModal').style.display).toBe('none');
    expect(document.getElementById('deleteUserModal').style.display).toBe('none');
  });

  test('clear button logs an error when its matching save button is missing', () => {
    loadBrowserScript('admin.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.save-prediction').remove();
    const clearButton = document.querySelector('.clear-prediction');

    clearButton.click();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Save button not found for clear action on match ID:',
      '44'
    );
  });
});
