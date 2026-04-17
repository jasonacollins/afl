// Admin panel JavaScript - extracted from inline scripts for CSP compliance

// Set admin flag
window.isAdmin = true;
window.canOverridePredictionLocks = true;

// Initialize with empty predictions
window.userPredictions = {};

// Get CSRF token from meta tag
function getCsrfToken() {
  const metaTag = document.querySelector('meta[name="csrf-token"]');
  return metaTag ? metaTag.getAttribute('content') : '';
}

// Modal functions
function showResetPasswordForm(userId, userName) {
  document.getElementById('resetUserName').textContent = userName;
  document.getElementById('resetPasswordForm').action = `/admin/reset-password/${userId}`;
  document.getElementById('newPassword').value = '';
  document.getElementById('resetPasswordModal').style.display = 'block';
}

function closeModal() {
  document.getElementById('resetPasswordModal').style.display = 'none';
}

function closeRefreshModal() {
  document.getElementById('refreshApiModal').style.display = 'none';
}

function closeUploadModal() {
  document.getElementById('uploadDatabaseModal').style.display = 'none';
}

function confirmDeleteUser(userId, userName) {
  document.getElementById('deleteUserName').textContent = userName;
  document.getElementById('deleteUserForm').action = `/admin/delete-user/${userId}`;
  document.getElementById('deleteUserModal').style.display = 'block';
}

function closeDeleteModal() {
  document.getElementById('deleteUserModal').style.display = 'none';
}

// Toggle predictor active status
function toggleActiveStatus(predictorId, newActiveStatus, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Updating...';

  fetch(`/admin/api/predictors/${predictorId}/toggle-active`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken()
    },
    body: JSON.stringify({ active: newActiveStatus })
  })
  .then(response => {
    if (!response.ok) {
      return response.text().then(text => {
        throw new Error(`HTTP ${response.status}: ${text}`);
      });
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Update button
      button.textContent = newActiveStatus ? 'Active' : 'Inactive';
      button.dataset.active = newActiveStatus.toString();
      button.className = newActiveStatus ? 'button primary-button' : 'button secondary-button';
      button.disabled = false;

      // Update row styling
      const row = button.closest('tr');
      if (newActiveStatus) {
        row.classList.remove('inactive-predictor');
      } else {
        row.classList.add('inactive-predictor');
      }
    } else {
      console.error('Server returned error:', data);
      alert('Error updating predictor status: ' + (data.message || 'Unknown error'));
      button.textContent = originalText;
      button.disabled = false;
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error updating predictor status: ' + error.message);
    button.textContent = originalText;
    button.disabled = false;
  });
}

// Function to select a user and update the UI
function selectUserByData(buttonElement) {
  const userId = buttonElement.getAttribute('data-user-id');
  const userName = buttonElement.getAttribute('data-display-name');
  selectUser(userId, userName);
}

// Added a separate function to directly clear a prediction without validation
function clearPredictionDirectly(matchId, userId, button) {
  if (!userId) {
    alert('Please select a user first');
    return;
  }

  const originalButtonText = button.textContent;
  button.textContent = 'Clearing...';
  button.disabled = true;

  const matchCardForClear = button.closest('.match-card');
  const input = matchCardForClear ? matchCardForClear.querySelector(`.home-prediction[data-match-id="${matchId}"]`) : null;
  const awayInput = matchCardForClear ? matchCardForClear.querySelector(`.away-prediction[data-match-id="${matchId}"]`) : null;

  fetch(`/admin/predictions/${userId}/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-CSRF-Token': getCsrfToken()
    },
    body: JSON.stringify({ matchId: matchId, probability: "" }), // Empty string for deletion
  })
  .then(response => {
    if (!response.ok) throw new Error(`Server error (${response.status})`);
    return response.json();
  })
  .then(data => {
    if (data.success) {
      if (input) input.value = '';
      if (awayInput) awayInput.value = '';

      button.textContent = 'Prediction Cleared';
      setTimeout(() => {
        button.textContent = 'Save Prediction';
        button.classList.remove('saved-state', 'update-state', 'delete-state');
        button.disabled = false;
      }, 1500);

      updateStoredPrediction(matchId, null, null);

      if (input) {
        input.dataset.originalValue = ''; // Crucial: Mark as empty for auto-save logic
      }

      if (matchCardForClear) {
        const metricsContainer = matchCardForClear.querySelector('.admin-metrics-display');
        if (metricsContainer) metricsContainer.innerHTML = '';
      }
    } else {
      button.textContent = data.error || 'Error!';
      setTimeout(() => {
        button.textContent = originalButtonText;
        button.disabled = false;
      }, 1500);
    }
  })
  .catch(error => {
    console.error('Error clearing prediction:', error);
    button.textContent = 'Failed!';
    setTimeout(() => {
      button.textContent = originalButtonText;
      button.disabled = false;
    }, 1500);
  });
}

// Function to add Clear buttons to each prediction after rendering
function addClearButtons() {
  document.querySelectorAll('.match-card').forEach(card => {
    if (card.querySelector('.clear-prediction')) return;

    const homePredictionInput = card.querySelector('.home-prediction');
    const matchId = homePredictionInput?.dataset?.matchId;

    if (matchId) {
      const predictionControls = card.querySelector('.prediction-controls');
      if (predictionControls && !card.querySelector('.clear-prediction')) {
        const clearButton = document.createElement('button');
        clearButton.className = 'button secondary-button clear-prediction';
        clearButton.textContent = 'Clear';
        clearButton.dataset.matchId = matchId;

        clearButton.addEventListener('click', function(e) {
          e.preventDefault();
          const currentMatchId = this.dataset.matchId;
          const userId = document.getElementById('selected-user-id').value;
          const saveBtn = predictionControls.querySelector(`.save-prediction[data-match-id="${currentMatchId}"]`);

          if (saveBtn) {
            // Call the overridden savePrediction with an empty string, which routes to clearPredictionDirectly
            window.savePrediction(currentMatchId, "", saveBtn);
          } else {
            console.error("Save button not found for clear action on match ID:", currentMatchId);
          }
        });

        const saveBtnElement = predictionControls.querySelector('.save-prediction');
        if (saveBtnElement) {
          saveBtnElement.insertAdjacentElement('afterend', clearButton);
        } else {
          predictionControls.appendChild(clearButton);
        }
      }
    }
  });
}

// Extend the fetchMatchesForRound function to add clear buttons after rendering
const originalFetchMatchesForRound = window.fetchMatchesForRound;
window.fetchMatchesForRound = function(round) {
  if (originalFetchMatchesForRound) {
    originalFetchMatchesForRound.call(this, round);

    // Add a slight delay to ensure DOM is updated
    setTimeout(addClearButtons, 500);
  }
};

if (typeof window !== 'undefined') {
  window.getCsrfToken = getCsrfToken;
  window.showResetPasswordForm = showResetPasswordForm;
  window.closeModal = closeModal;
  window.closeRefreshModal = closeRefreshModal;
  window.closeUploadModal = closeUploadModal;
  window.confirmDeleteUser = confirmDeleteUser;
  window.closeDeleteModal = closeDeleteModal;
  window.toggleActiveStatus = toggleActiveStatus;
  window.selectUserByData = selectUserByData;
  window.clearPredictionDirectly = clearPredictionDirectly;
  window.addClearButtons = addClearButtons;
}

// DOM Content Loaded event handler
document.addEventListener('DOMContentLoaded', function() {
  // Override savePrediction for admin-specific behavior
  window.savePredictionOriginal = window.savePrediction;
  window.savePrediction = function(matchId, probabilityString, button) { // probabilityString is from input/blur
    const userId = document.getElementById('selected-user-id').value;

    if (!userId) {
      alert('Please select a user first');
      // Revert button if it was changed by a direct click before this check
      if (button.textContent === 'Saving...') {
        const inputElem = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
        const originalVal = inputElem ? inputElem.dataset.originalValue || "" : "";
        if (originalVal !== "" && originalVal === probabilityString) button.textContent = 'Saved';
        else if (originalVal !== "") button.textContent = 'Update Prediction';
        else button.textContent = 'Save Prediction';
      }
      button.disabled = false;
      return;
    }

    if (probabilityString === "" || probabilityString === null) {
      clearPredictionDirectly(matchId, userId, button);
      return;
    }

    const numericProb = parseInt(probabilityString);
    if (isNaN(numericProb) || numericProb < 0 || numericProb > 100) {
      alert('Prediction must be a number between 0 and 100.');
      const inputElem = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      if (inputElem) {
        const originalVal = inputElem.dataset.originalValue || "";
        inputElem.value = originalVal; // Revert input to original saved value
        // Revert button text based on original value state
        if (originalVal !== "") {
          button.textContent = (probabilityString === originalVal) ? 'Saved' : 'Update Prediction';
        } else {
          button.textContent = 'Save Prediction';
        }
        inputElem.dispatchEvent(new Event('input', { bubbles: true })); // Update away input etc.
      } else {
        button.textContent = 'Save Prediction'; // Fallback
      }
      button.disabled = false;
      return;
    }

    const originalButtonText = button.textContent;
    // Avoid nested "Saving..." if called rapidly or from blur then click
    if (button.textContent !== 'Saving...' && button.textContent !== 'Clearing...') {
      button.textContent = 'Saving...';
    }
    button.disabled = true;

    let tippedTeamForPayload = undefined;
    if (numericProb === 50) {
      // Use tippedTeam from button dataset (set by UI or blur event)
      // Default to 'home' if not present, though UI should ensure it is.
      tippedTeamForPayload = button.dataset.tippedTeam || 'home';
    }

    fetch(`/admin/predictions/${userId}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({
        matchId: matchId,
        probability: numericProb, // Send the numeric probability
        tippedTeam: tippedTeamForPayload
      }),
    })
    .then(response => {
      if (!response.ok) throw new Error(`Server error (${response.status})`);
      return response.json();
    })
    .then(data => {
      const inputElement = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      if (data.success) {
        button.textContent = 'Saved';
        button.classList.add('saved-state');
        button.classList.remove('update-state', 'delete-state');

        updateStoredPrediction(matchId, numericProb, tippedTeamForPayload);

        if (inputElement) {
          // Crucial: Update original value for auto-save logic
          inputElement.dataset.originalValue = String(numericProb);
        }

        const matchCard = button.closest('.match-card');
        if (matchCard) {
          const metricsContainer = matchCard.querySelector('.admin-metrics-display');
          const matchData = getMatchDataById(matchId);
          if (metricsContainer && matchData && matchData.hscore !== null && matchData.ascore !== null) {
            metricsContainer.innerHTML = calculateAccuracy(matchData, numericProb, tippedTeamForPayload);
          } else if (metricsContainer) {
            metricsContainer.innerHTML = '';
          }
        }
        setTimeout(() => { button.disabled = false; }, 500);
      } else {
        alert(data.error || 'Failed to save prediction.');
        button.textContent = originalButtonText;
        button.disabled = false;
      }
    })
    .catch(error => {
      console.error('Error saving prediction:', error);
      alert('An error occurred. Please try again.');
      button.textContent = originalButtonText;
      button.disabled = false;
    });
  };

  // Initialize clear buttons after a short delay to ensure all other scripts have run
  setTimeout(addClearButtons, 500);

  // Handle API refresh button
  const refreshButton = document.getElementById('refreshApiButton');
  const refreshForm = document.getElementById('refreshApiForm');
  const uploadButton = document.getElementById('uploadDatabaseButton');
  const uploadForm = document.getElementById('uploadDatabaseForm');

  if (refreshButton) {
    refreshButton.addEventListener('click', function() {
      document.getElementById('refreshApiModal').style.display = 'block';
    });
  }

  if (uploadButton) {
    uploadButton.addEventListener('click', function() {
      document.getElementById('uploadDatabaseModal').style.display = 'block';
    });
  }

  if (refreshForm) {
    refreshForm.addEventListener('submit', function(e) {
      e.preventDefault();

      const year = document.getElementById('refreshYear').value;
      const forceScoreUpdate = document.getElementById('forceScoreUpdate').checked;
      const statusDiv = document.getElementById('refreshStatus');
      const submitButton = this.querySelector('button[type="submit"]');

      // Update UI
      const forceUpdateMsg = forceScoreUpdate ? ' with force score update enabled' : '';
      statusDiv.innerHTML = `<p class="alert success">Refreshing data from API${forceUpdateMsg}, please wait...</p>`;
      submitButton.disabled = true;

      // Make API request
      fetch('/admin/api-refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({
          year,
          forceScoreUpdate
        }),
      })
      .then(response => {
        if (!response.ok) throw new Error(`Server error (${response.status})`);
        return response.json();
      })
      .then(data => {
        if (data.success) {
          let statusHTML = `<p class="alert success">${data.message}</p>`;

          // Add skipped games information if available
          if (data.skippedGames && data.skippedGames.length > 0) {
            statusHTML += '<div class="skipped-games">';
            statusHTML += '<h4>Skipped Games:</h4>';
            statusHTML += '<ul>';
            data.skippedGames.forEach(game => {
              statusHTML += `<li>${game}</li>`;
            });
            statusHTML += '</ul>';
            statusHTML += '</div>';
          }

          statusDiv.innerHTML = statusHTML;
        } else {
          statusDiv.innerHTML = `<p class="alert error">${data.message}</p>`;
        }

        // Re-enable the button after 3 seconds
        setTimeout(() => {
          submitButton.disabled = false;
        }, 3000);
      })
      .catch(error => {
        console.error('Fetch error:', error);
        statusDiv.innerHTML = `<p class="alert error">Error: ${error.message}</p>`;
        submitButton.disabled = false;
      });
    });
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', function(e) {
      e.preventDefault();

      const fileInput = document.getElementById('databaseFile');
      const statusDiv = document.getElementById('uploadStatus');
      const submitButton = this.querySelector('button[type="submit"]');

      if (!fileInput.files.length) {
        statusDiv.innerHTML = '<p class="alert error">Please select a database file.</p>';
        return;
      }

      const formData = new FormData();
      formData.append('databaseFile', fileInput.files[0]);

      // Update UI
      statusDiv.innerHTML = '<p class="alert success">Uploading database, please wait...</p>';
      submitButton.disabled = true;

      // Add CSRF token to form data
      formData.append('_csrf', getCsrfToken());

      fetch('/admin/upload-database', {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        },
        body: formData
      })
      .then(response => {
        if (!response.ok) throw new Error(`Server error (${response.status})`);
        return response.json();
      })
      .then(data => {
        if (data.success) {
          statusDiv.innerHTML = '<p class="alert success">' + data.message + '</p>';
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          statusDiv.innerHTML = '<p class="alert error">' + data.message + '</p>';
          submitButton.disabled = false;
        }
      })
      .catch(error => {
        console.error('Upload error:', error);
        statusDiv.innerHTML = '<p class="alert error">Error: ' + error.message + '</p>';
        submitButton.disabled = false;
      });
    });
  }

  // Add event listeners for user selection buttons using event delegation
  const userButtons = document.querySelector('.user-buttons');
  if (userButtons) {
    userButtons.addEventListener('click', function(e) {
      const button = e.target.closest('.user-button');
      if (button) {
        selectUserByData(button);
      }
    });
  }

  // Add event listeners for modal close buttons using event delegation
  document.addEventListener('click', function(e) {
    // Handle reset password modal actions
    if (e.target.closest('[data-action="show-reset-password"]')) {
      const button = e.target.closest('[data-action="show-reset-password"]');
      const userId = button.dataset.userId;
      const userName = button.dataset.userName;
      showResetPasswordForm(userId, userName);
    }

    // Handle delete user modal actions
    if (e.target.closest('[data-action="confirm-delete-user"]')) {
      const button = e.target.closest('[data-action="confirm-delete-user"]');
      const userId = button.dataset.userId;
      const userName = button.dataset.userName;
      confirmDeleteUser(userId, userName);
    }

    // Handle toggle active status
    if (e.target.closest('[data-action="toggle-active-status"]')) {
      const button = e.target.closest('[data-action="toggle-active-status"]');
      const predictorId = button.dataset.predictorId;
      const isActive = button.dataset.active === 'true';
      toggleActiveStatus(predictorId, !isActive, button);
    }

    // Handle close buttons
    if (e.target.closest('[data-action="close-modal"]')) {
      closeModal();
    }
    if (e.target.closest('[data-action="close-refresh-modal"]')) {
      closeRefreshModal();
    }
    if (e.target.closest('[data-action="close-upload-modal"]')) {
      closeUploadModal();
    }
    if (e.target.closest('[data-action="close-delete-modal"]')) {
      closeDeleteModal();
    }
  });
});

// Close modal if user clicks outside of it
window.onclick = function(event) {
  const resetModal = document.getElementById('resetPasswordModal');
  const refreshModal = document.getElementById('refreshApiModal');
  const uploadModal = document.getElementById('uploadDatabaseModal');
  const deleteModal = document.getElementById('deleteUserModal');

  if (event.target === resetModal) {
    closeModal();
  } else if (event.target === refreshModal) {
    closeRefreshModal();
  } else if (event.target === uploadModal) {
    closeUploadModal();
  } else if (event.target === deleteModal) {
    closeDeleteModal();
  }
};
