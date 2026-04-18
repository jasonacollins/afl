// Main predictions page behavior shared with admin prediction management.
let currentMatchesData = []; // Store current matches

document.addEventListener('DOMContentLoaded', function() {
  if (isAdminUserPredictionsPage()) {
    window.isAdmin = true;
    window.canOverridePredictionLocks = true;

    const userButtons = document.querySelectorAll('.user-button');
    userButtons.forEach((button) => {
      if (button.dataset.selectionBound === 'true') {
        return;
      }

      button.dataset.selectionBound = 'true';
      button.addEventListener('click', function() {
        const userId = button.dataset.userId;
        const userName = button.dataset.displayName || button.textContent.trim();
        selectUser(userId, userName);
      });
    });
  }

  // Format all existing date elements on the page
  const dateElements = document.querySelectorAll('.match-date');
  dateElements.forEach(element => {
    const originalDate = element.textContent;
    if (originalDate && originalDate.includes('T')) {
      element.setAttribute('data-original-date', originalDate);
      element.textContent = formatDateToLocalTimezone(originalDate);
    }
  });
  
  // Handle round selection
  const roundButtons = document.querySelectorAll('.round-button');
  if (roundButtons.length > 0) {
    roundButtons.forEach(button => {
      button.addEventListener('click', function() {
        const round = this.dataset.round;
        fetchMatchesForRound(round);
      });
    });
  }
  
  // Handle home prediction inputs
  initPredictionInputs();
  
  // Handle save prediction buttons
  initSavePredictionButtons();
  
  // Update round button states
  updateRoundButtonStates();
});

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

function getStoredPrediction(matchId) {
  if (!window.userPredictions || !(matchId in window.userPredictions)) {
    return null;
  }

  const storedPrediction = window.userPredictions[matchId];

  if (storedPrediction === null || storedPrediction === undefined) {
    return null;
  }

  if (typeof storedPrediction === 'object') {
    return {
      probability: storedPrediction.probability !== null && storedPrediction.probability !== undefined
        ? String(storedPrediction.probability)
        : '',
      tippedTeam: storedPrediction.tippedTeam || storedPrediction.tipped_team || 'home'
    };
  }

  return {
    probability: String(storedPrediction),
    tippedTeam: 'home'
  };
}

function canBypassPredictionLocks() {
  return window.canOverridePredictionLocks === true;
}

function fetchJsonNoStore(url) {
  return fetch(url, { cache: 'no-store' })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    });
}

function isAdminUserPredictionsPage() {
  return typeof window !== 'undefined' && window.location.pathname.includes('/admin/user-predictions');
}

function fetchMatchesData(round, year) {
  if (isAdminUserPredictionsPage()) {
    const selectedUserId = document.getElementById('selected-user-id')?.value;
    if (selectedUserId) {
      return fetchJsonNoStore(
        `/admin/predictions/${encodeURIComponent(selectedUserId)}/round/${encodeURIComponent(round)}?year=${year}`
      );
    }
  }

  if (typeof window !== 'undefined' && typeof window.getMatchesForRoundData === 'function') {
    return window.getMatchesForRoundData(round, year);
  }

  return fetchJsonNoStore(`/predictions/round/${encodeURIComponent(round)}?year=${year}`);
}

function showMatchesLoadError(matchesContainer, error) {
  console.error('Error fetching matches:', error);

  if (!matchesContainer) {
    return;
  }

  matchesContainer.replaceChildren();

  const errorElement = document.createElement('div');
  errorElement.className = 'error';
  errorElement.textContent = 'Failed to load matches';
  matchesContainer.appendChild(errorElement);
}

// Update match list for selected round via AJAX
function fetchMatchesForRound(round) {
  // Get the current year from the URL or use the selected year
  const urlParams = new URLSearchParams(window.location.search);
  const year = urlParams.get('year') || new Date().getFullYear();
  
  // Show loading state
  const matchesContainer = document.getElementById('matches-container');
  if (matchesContainer) {
    matchesContainer.innerHTML = '<div class="loading">Loading matches...</div>';
  }
  
  // Update UI to show selected round
  const roundButtons = document.querySelectorAll('.round-button');
  roundButtons.forEach(btn => {
    // Keep any existing state classes (completed, has-predictions, needs-predictions)
    // but remove the 'selected' class
    btn.classList.remove('selected');
    
    if (btn.dataset.round === round) {
      // Add selected class (this will override other colors due to !important)
      btn.classList.add('selected');
    }
  });
  
  // Fetch matches from server with year parameter
  fetchMatchesData(round, year)
    .then(matches => {
      try {
        currentMatchesData = matches; // Store fetched matches
        renderMatches(matches);
        // Call our new function to update round button states
        updateRoundButtonStates();
      } catch (error) {
        showMatchesLoadError(matchesContainer, error);
      }
    })
    .catch(error => {
      showMatchesLoadError(matchesContainer, error);
    });
}

// Render matches in the container
function renderMatches(matches) {
  const matchesContainer = document.getElementById('matches-container');
  if (!matchesContainer) return;
  
  if (matches.length === 0) {
    matchesContainer.innerHTML = '<div class="no-matches">No matches available for this round</div>';
    return;
  }
  
  let html = '';
  
  matches.forEach(match => {
    const isLocked = match.isLocked;
    const hasResult = match.hscore !== null && match.ascore !== null;

    let prediction = '';
    let tippedTeam = 'home'; // Default for 50%

    const storedPrediction = getStoredPrediction(match.match_id);
    if (storedPrediction) {
      prediction = storedPrediction.probability;
      tippedTeam = storedPrediction.tippedTeam;
    }

    const awayPrediction = prediction !== '' && !isNaN(parseInt(prediction)) ? (100 - parseInt(prediction)) : '';
    const hasPrediction = prediction !== '';

    const buttonClass = hasPrediction ? 'save-prediction saved-state' : 'save-prediction';
    const buttonText = hasPrediction ? 'Saved' : 'Save Prediction';

    // Add data-abbrev to team divs for easier access in JS if needed
    const homeTeamName = (match.home_team === 'Greater Western Sydney' && match.home_team_abbrev) ? match.home_team_abbrev : match.home_team;
    const awayTeamName = (match.away_team === 'Greater Western Sydney' && match.away_team_abbrev) ? match.away_team_abbrev : match.away_team;

    html += `
      <div class="match-card ${hasResult ? 'has-result' : ''} ${isLocked ? 'locked' : ''}">
        <div class="match-header">
          <span class="match-date" data-original-date="${match.match_date}">${formatDateToLocalTimezone(match.match_date)}</span>
          <span class="match-venue">${match.venue}</span>
          ${isLocked ? '<span class="match-locked">LOCKED</span>' : ''}
        </div>

        <div class="match-teams">
          <div class="home-team" data-abbrev="${match.home_team_abbrev || ''}">${homeTeamName}</div>
          <div class="vs">vs</div>
          <div class="away-team" data-abbrev="${match.away_team_abbrev || ''}">${awayTeamName}</div>
        </div>

        ${hasResult ? `
          <div class="match-result">
            <span class="score">${match.hscore} - ${match.ascore}</span>
          </div>
        ` : ''}

        ${(!isLocked || canBypassPredictionLocks()) ? `
          <div class="prediction-controls">
            <div class="prediction-inputs">
              <div class="team-prediction">
                <div class="input-with-symbol">
                  <input type="number" 
                         class="prediction-input home-prediction" 
                         data-match-id="${match.match_id}" 
                         data-original-value="${prediction}"
                         min="0" max="100" 
                         value="${prediction}">
                  <span class="input-symbol">%</span>
                </div>
              </div>

              <div class="team-prediction">
                <div class="input-with-symbol">
                  <input type="number" 
                         class="prediction-input away-prediction" 
                         data-match-id="${match.match_id}" 
                         min="0" max="100" 
                         value="${awayPrediction}"
                         readonly
                         tabindex="-1">
                  <span class="input-symbol">%</span>
                </div>
              </div>
            </div>

            ${parseInt(prediction) === 50 && hasPrediction ? `
              <div id="team-selection-${match.match_id}" class="team-selection">
                <p>Who do you think will win?</p>
                <div class="team-buttons">
                  <button type="button" class="team-button home-team-button ${tippedTeam === 'home' ? 'selected' : ''}" data-team="home">${homeTeamName}</button>
                  <button type="button" class="team-button away-team-button ${tippedTeam === 'away' ? 'selected' : ''}" data-team="away">${awayTeamName}</button>
                </div>
              </div>
            ` : ''}

            <button class="${buttonClass}" 
                    data-match-id="${match.match_id}"
                    data-tipped-team="${(parseInt(prediction) === 50 && hasPrediction) ? tippedTeam : ''}">
              ${buttonText}
            </button>
            ${(window.isAdmin && hasResult && hasPrediction) ? `
              <div class="admin-metrics-display">
                ${calculateAccuracy(match, parseInt(prediction), tippedTeam)}
              </div>
            ` : ''}
          </div>
        ` : isLocked ? `
          <div class="prediction-locked">
            ${hasPrediction ? `
              <p>Your prediction: ${prediction}% for ${homeTeamName}</p>
              ${parseInt(prediction) === 50 ? `
                <p>Tipped: ${tippedTeam === 'home' ? homeTeamName : awayTeamName} to win</p>
              ` : ''}
            ` : `
              <p>No prediction made</p>
            `}
            ${!hasResult ? `<p class="locked-message">Match has started - predictions locked</p>` : ''}
            ${hasResult && hasPrediction ? calculateAccuracy(match, parseInt(prediction), tippedTeam) : ''}
          </div>
        ` : ''}
      </div>
    `;
  });
  
  matchesContainer.innerHTML = html;
  
  initPredictionInputs();
  initSavePredictionButtons();

  if (typeof window !== 'undefined' && typeof window.onMatchesRendered === 'function') {
    window.onMatchesRendered();
  }
}

// Calculate prediction accuracy text
function calculateAccuracy(match, prediction, tippedTeam) {
  if (match.hscore === null || match.ascore === null || prediction === '') {
    return '';
  }

  if (match.adminMetrics) {
    return `<div class="metrics-details">
      <p>Tip: <span class="${match.adminMetrics.tipClass}">${match.adminMetrics.tipPoints}</span> | Brier: ${match.adminMetrics.brierScore} | Bits: ${match.adminMetrics.bitsScore}</p>
    </div>`;
  }

  const homeWon = match.hscore > match.ascore;
  const tie = match.hscore === match.ascore;
  
  // Determine actual outcome
  const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
  
  // Calculate Brier score using the global function
  const brierScore = calculateBrierScore(parseInt(prediction), actualOutcome).toFixed(4);
  
  // Calculate Bits score using the global function  
  const bitsScore = calculateBitsScore(parseInt(prediction), actualOutcome).toFixed(4);
  
  // Calculate tip points using the global function
  const tipPoints = calculateTipPoints(parseInt(prediction), match.hscore, match.ascore, tippedTeam);
  
  // Determine tip class
  let tipClass = "incorrect";
  if (tipPoints === 1) {
    tipClass = "correct";
  } else if (tie && parseInt(prediction) !== 50) {
    tipClass = "partial";
  }
  
  return `<div class="metrics-details">
    <p>Tip: <span class="${tipClass}">${tipPoints}</span> | Brier: ${brierScore} | Bits: ${bitsScore}</p>
  </div>`;
}

// Handle prediction inputs
function initPredictionInputs() {
  const homeInputs = document.querySelectorAll('.home-prediction');
  
  homeInputs.forEach(input => {
    if (input.dataset.predictionInputBound === 'true') {
      return;
    }

    input.dataset.predictionInputBound = 'true';

    // data-original-value is set by renderMatches or by savePrediction.
    // Do not set input.dataset.originalValue = input.value here.

    input.addEventListener('wheel', function(event) {
      // Prevent the browser from incrementing/decrementing focused number inputs
      // while the user scrolls through the prediction list.
      if (document.activeElement === this && typeof this.blur === 'function') {
        event.preventDefault();
        this.blur();
      }
    }, { passive: false });
    
    input.addEventListener('input', function() {
      const matchId = this.dataset.matchId;
      const value = this.value.trim();
      const originalValue = this.dataset.originalValue || ""; // From dataset, default empty
      
      const awayInput = document.querySelector(`.away-prediction[data-match-id="${matchId}"]`);
      const saveButton = document.querySelector(`.save-prediction[data-match-id="${matchId}"]`);
      
      if (awayInput) {
        if (value === '' || isNaN(parseInt(value))) {
          awayInput.value = '';
          removeTeamSelection(matchId);
          if (saveButton) {
            if (originalValue !== '') { // Clearing an existing prediction
              saveButton.textContent = 'Clear Prediction';
              saveButton.classList.remove('saved-state', 'update-state');
              saveButton.classList.add('delete-state');
            } else { // Input was empty, remains empty or invalid
              saveButton.textContent = 'Save Prediction';
              saveButton.classList.remove('saved-state', 'update-state', 'delete-state');
            }
            delete saveButton.dataset.tippedTeam; // Clear tipped team from button
          }
        } else {
          let homeValue = parseInt(value);
          // Enforce limits
          if (homeValue < 0) homeValue = 0;
          if (homeValue > 100) homeValue = 100;
          // Update input field if value was corrected (e.g., "abc" or out of bounds)
          if (String(homeValue) !== this.value.trim()) {
             this.value = homeValue;
          }
          
          awayInput.value = 100 - homeValue;
          
          if (saveButton) {
            const valueChanged = String(homeValue) !== originalValue;
            
            if (originalValue !== '' && valueChanged) {
              saveButton.textContent = 'Update Prediction';
              saveButton.classList.remove('saved-state', 'delete-state');
              saveButton.classList.add('update-state');
            } else if (originalValue !== '' && !valueChanged) {
              saveButton.textContent = 'Saved'; // Value matches original saved value
              saveButton.classList.add('saved-state');
              saveButton.classList.remove('update-state', 'delete-state');
            } else if (originalValue === '' && String(homeValue) !== '') { // New prediction being entered
              saveButton.textContent = 'Save Prediction';
              saveButton.classList.remove('saved-state', 'update-state', 'delete-state');
            }
            // else: originalValue was empty, and current value is empty (handled by the first if block)

            const teamSelectionContainer = document.getElementById(`team-selection-${matchId}`);
            if (homeValue === 50) {
              if (!teamSelectionContainer) {
                const matchCard = input.closest('.match-card');
                if (matchCard) {
                  const homeTeamElement = matchCard.querySelector('.home-team');
                  const awayTeamElement = matchCard.querySelector('.away-team');
                  const homeTeamName = homeTeamElement ? (homeTeamElement.dataset.abbrev || homeTeamElement.textContent) : 'Home';
                  const awayTeamName = awayTeamElement ? (awayTeamElement.dataset.abbrev || awayTeamElement.textContent) : 'Away';
                  addTeamSelection(matchId, homeTeamName, awayTeamName, saveButton);
                }
              }
            } else { // Not 50%
              removeTeamSelection(matchId);
              delete saveButton.dataset.tippedTeam; // Clear tipped team from button
            }
          }
        }
      }
    });

    // Auto-save on blur ONLY for initial valid entry
    input.addEventListener('blur', function(event) {
      const matchId = event.target.dataset.matchId;
      const currentInputValue = event.target.value.trim();
      // data-original-value is set when matches are rendered or after a save.
      // If it's empty, it means no prediction was loaded/saved for this input yet.
      const originalSavedValue = event.target.dataset.originalValue || "";

      // Only auto-save if:
      // 1. There was no original saved value (it's an initial entry).
      // 2. The current input value is not empty.
      // 3. The current input value is a valid number between 0 and 100.
      if (originalSavedValue === "" && currentInputValue !== "") {
        const numericProb = parseInt(currentInputValue);
        if (!isNaN(numericProb) && numericProb >= 0 && numericProb <= 100) {
          const saveButton = document.querySelector(`.save-prediction[data-match-id="${matchId}"]`);
          if (saveButton) {
            // If it's 50%, ensure saveButton.dataset.tippedTeam is set if team selection UI is present
            if (numericProb === 50) {
                const teamSelectionContainer = document.getElementById(`team-selection-${matchId}`);
                if (teamSelectionContainer && !saveButton.dataset.tippedTeam) {
                    const selectedTeamButton = teamSelectionContainer.querySelector('.team-button.selected');
                    if (selectedTeamButton) {
                        saveButton.dataset.tippedTeam = selectedTeamButton.dataset.team;
                    } else {
                        // addTeamSelection defaults to 'home' and selects it, so this should be set.
                        // If not, savePrediction will default to 'home'.
                        saveButton.dataset.tippedTeam = 'home'; 
                    }
                } else if (!teamSelectionContainer && !saveButton.dataset.tippedTeam) {
                    // If UI not yet added but it's 50, default for auto-save
                    saveButton.dataset.tippedTeam = 'home';
                }
            }
            // Call the global savePrediction function (could be admin version)
            window.savePrediction(matchId, currentInputValue, saveButton);
          }
        }
        // No 'else' here: if invalid initial entry, user must click button (which validates)
      }
      // If originalSavedValue is not empty, or currentInputValue is empty, no auto-save on blur.
    });
  });
}

// Function to update round button states
function updateRoundButtonStates() {
  // Get all round buttons
  const roundButtons = document.querySelectorAll('.round-button');
  
  // For each round button, check its state
  roundButtons.forEach(async (button) => {
    const round = button.dataset.round;
    
    // Get the current year from the URL or use the selected year
    const urlParams = new URLSearchParams(window.location.search);
    const year = urlParams.get('year') || new Date().getFullYear();
    
    try {
      // 1. Check if the round is completed
      // Fetch matches for this round to check if they're completed
      const matches = await fetchJsonNoStore(`/predictions/round/${round}?year=${year}`);
      
      // Round is completed if all matches have scores
      const isCompleted = matches.length > 0 && matches.every(match => 
        match.hscore !== null && match.ascore !== null
      );
      
      // 2. Check if the round has any predictions
      const hasPredictions = matches.some(match => 
        getStoredPrediction(match.match_id) !== null
      );
      
      // 3. Set the appropriate class
      button.classList.remove('completed', 'has-predictions', 'needs-predictions');
      
      if (isCompleted) {
        button.classList.add('completed');
      } else if (hasPredictions) {
        button.classList.add('has-predictions');
      } else {
        button.classList.add('needs-predictions');
      }
    } catch (error) {
      console.error('Error checking round state:', error);
    }
  });
}

// Helper function to add team selection UI
function addTeamSelection(matchId, homeTeam, awayTeam, saveButton) {
  // First remove any existing team selection
  removeTeamSelection(matchId);
  
  // Create team selection container
  const teamSelection = document.createElement('div');
  teamSelection.className = 'team-selection';
  teamSelection.id = `team-selection-${matchId}`;
  teamSelection.innerHTML = `
    <p>Who do you think will win?</p>
    <div class="team-buttons">
      <button type="button" class="team-button home-team-button" data-team="home">${(homeTeam === 'Greater Western Sydney' && saveButton.closest('.match-card').querySelector('.home-team').dataset.abbrev) ? saveButton.closest('.match-card').querySelector('.home-team').dataset.abbrev : homeTeam}</button>
      <button type="button" class="team-button away-team-button" data-team="away">${(awayTeam === 'Greater Western Sydney' && saveButton.closest('.match-card').querySelector('.away-team').dataset.abbrev) ? saveButton.closest('.match-card').querySelector('.away-team').dataset.abbrev : awayTeam}</button>
    </div>
  `;
  
  // Insert it before the save button
  saveButton.parentNode.insertBefore(teamSelection, saveButton);
  
  // Add event listeners to team buttons
  const homeButton = teamSelection.querySelector('.home-team-button');
  const awayButton = teamSelection.querySelector('.away-team-button');
  
  homeButton.addEventListener('click', function() {
    homeButton.classList.add('selected');
    awayButton.classList.remove('selected');
    saveButton.dataset.tippedTeam = 'home';
  });
  
  awayButton.addEventListener('click', function() {
    awayButton.classList.add('selected');
    homeButton.classList.remove('selected');
    saveButton.dataset.tippedTeam = 'away';
  });
  
  // Default to home team
  homeButton.click();
}

function removeTeamSelection(matchId) {
  const teamSelection = document.getElementById(`team-selection-${matchId}`);
  if (teamSelection) {
    teamSelection.remove();
  }
}

// Handle save prediction buttons
function initSavePredictionButtons() {
  const saveButtons = document.querySelectorAll('.save-prediction');
  
  saveButtons.forEach(button => {
    button.addEventListener('click', function() {
      const matchId = this.dataset.matchId;
      const input = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      
      if (input) {
        // Check if this is the Clear Prediction button
        const isDeleteAction = this.classList.contains('delete-state');
        
        // If it's clear prediction, allow empty value
        const probability = isDeleteAction ? "" : input.value.trim();
        
        // Validate input only if it's not a delete action and not an empty string
        if (!isDeleteAction && probability !== '') {
          const probabilityNum = parseInt(probability);
          if (isNaN(probabilityNum) || probabilityNum < 0 || probabilityNum > 100) {
            alert('Please enter a valid percentage between 0 and 100');
            return;
          }
        }
        
        // For 50% predictions, ensure a team is selected
        if (!isDeleteAction && probability !== '' && parseInt(probability) === 50) {
          const tippedTeam = this.dataset.tippedTeam;
          if (!tippedTeam) {
            alert('Please select which team you think will win');
            return;
          }
        }
        
        savePrediction(matchId, probability, this);
      }
    });
  });
  
  // Also add click handlers for the team selection buttons that may already be in the DOM
  document.querySelectorAll('.team-button').forEach(button => {
    button.addEventListener('click', function() {
      const teamSelection = this.closest('.team-selection');
      if (!teamSelection) return;
      
      const matchId = teamSelection.id.replace('team-selection-', '');
      const saveButton = document.querySelector(`.save-prediction[data-match-id="${matchId}"]`);
      if (!saveButton) return;
      
      const teamButtons = teamSelection.querySelectorAll('.team-button');
      teamButtons.forEach(btn => btn.classList.remove('selected'));
      this.classList.add('selected');
      
      saveButton.dataset.tippedTeam = this.dataset.team;
    });
  });
}

// Save prediction via AJAX (general user version)
function savePrediction(matchId, probability, button) {
  const isDeleting = probability === "" || probability === null;
  let probValue = null; // This will be the numeric value or null
  let tippedTeamPayload = undefined; // To be sent in JSON body

  if (!isDeleting) {
    const parsedProb = parseInt(probability);
    if (isNaN(parsedProb) || parsedProb < 0 || parsedProb > 100) {
      alert('Prediction must be a number between 0 and 100, or empty to clear.');
      const inputElem = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
      // Revert button text based on original value state
      if (inputElem) {
        const originalVal = inputElem.dataset.originalValue || "";
        if (originalVal !== "") {
            button.textContent = (probability === originalVal) ? 'Saved' : 'Update Prediction';
        } else {
            button.textContent = 'Save Prediction';
        }
        inputElem.value = originalVal; // Revert input
        inputElem.dispatchEvent(new Event('input')); // Trigger input event to fix away input etc.
      } else {
        button.textContent = 'Save Prediction'; // Fallback
      }
      button.disabled = false;
      return;
    }
    probValue = parsedProb; // Store the valid numeric probability
    if (probValue === 50) {
      // Get tippedTeam from button's dataset; default to 'home' if not set
      tippedTeamPayload = button.dataset.tippedTeam || 'home';
    }
  }

  const originalButtonText = button.textContent; // Store current text before "Saving..."
  button.textContent = isDeleting ? 'Clearing...' : 'Saving...';
  button.disabled = true;

  const csrfToken = getCsrfToken();
  if (!csrfToken) {
    alert('Security token missing. Please refresh the page and try again.');
    button.textContent = originalButtonText;
    button.disabled = false;
    return;
  }
  
  fetch('/predictions/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
      matchId: matchId,
      probability: probValue, // Send numeric probability or null
      tippedTeam: tippedTeamPayload // Send tippedTeam (undefined if not 50%)
    }),
  })
  .then(response => response.json())
  .then(data => {
    const inputElement = document.querySelector(`.home-prediction[data-match-id="${matchId}"]`);
    if (data.success) {
      if (isDeleting) {
        button.textContent = 'Cleared';
        setTimeout(() => {
          button.textContent = 'Save Prediction';
          button.classList.remove('saved-state', 'update-state', 'delete-state');
          button.disabled = false;
        }, 1500);
        
        updateStoredPrediction(matchId, null, null); // Clear with nulls
        
        if (inputElement) {
          inputElement.dataset.originalValue = ''; // Update original value to empty
        }
      } else { // Successfully saved or updated a non-empty prediction
        button.textContent = 'Saved';
        button.classList.add('saved-state');
        button.classList.remove('update-state', 'delete-state');
        
        // probValue is numeric, tippedTeamPayload is set if 50%
        updateStoredPrediction(matchId, probValue, tippedTeamPayload); 
        
        if (inputElement) {
          inputElement.dataset.originalValue = String(probValue); // Update original value
        }
        
        setTimeout(() => {
          button.disabled = false;
        }, 500);
      }
      updateRoundButtonStates(); // Update round button states on any change
    } else {
      alert(data.error || 'Failed to save prediction.');
      button.textContent = originalButtonText; // Revert to text before "Saving..."
      button.disabled = false;
    }
  })
  .catch(error => {
    console.error('Error saving prediction:', error);
    alert('An error occurred. Please try again.');
    button.textContent = originalButtonText; // Revert to text before "Saving..."
    button.disabled = false;
  });
}

// Update stored prediction
function updateStoredPrediction(matchId, value, tippedTeam) {
  if (!window.userPredictions) {
    window.userPredictions = {};
  }
  // Ensure value is an integer for probability, or null if clearing
  const probabilityValue = (value === "" || value === null || value === undefined || isNaN(parseInt(value))) ? null : parseInt(value);

  if (probabilityValue === null) {
      // If clearing prediction, remove the entry
      if (window.userPredictions[matchId]) {
          delete window.userPredictions[matchId];
      }
  } else {
      window.userPredictions[matchId] = {
        probability: probabilityValue,
        tippedTeam: tippedTeam
      };
  }
}

// Helper function to find match data by ID
function getMatchDataById(matchId) {
  // Ensure matchId is treated consistently (e.g., as a string if it comes from dataset, or number if from numeric source)
  return currentMatchesData.find(m => String(m.match_id) === String(matchId));
}

// Helper for admin user selection
function selectUser(userId, userName) {
  document.getElementById('selected-user').textContent = userName;
  document.getElementById('selected-user-id').value = userId;
  
  // Highlight selected user
  const userButtons = document.querySelectorAll('.user-button');
  userButtons.forEach(btn => {
    btn.classList.remove('selected');
    if (btn.dataset.userId === userId) {
      btn.classList.add('selected');
    }
  });
  
  // If on admin page, fetch predictions for this user
  if (isAdminUserPredictionsPage()) {
    fetchJsonNoStore(`/admin/predictions/${userId}`)
      .then(data => {
        window.userPredictions = data.predictions;
        const selectedRoundButton = document.querySelector('.round-button.selected')
          || document.querySelector('.round-button');

        if (selectedRoundButton) {
          fetchMatchesForRound(selectedRoundButton.dataset.round);
        }
      })
      .catch(error => {
        console.error('Error fetching user predictions:', error);
      });
  }
}

function formatDateToLocalTimezone(isoDateString) {
  if (!isoDateString) return '';
  
  try {
    // Create a date object from the ISO string
    const date = new Date(isoDateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return isoDateString;
    
    // Format with Australian English date formatting
    const options = { 
      weekday: 'short',
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    
    return date.toLocaleString('en-AU', options);
  } catch (error) {
    console.error('Error formatting date:', error);
    return isoDateString;
  }
}

if (typeof window !== 'undefined') {
  window.getCsrfToken = getCsrfToken;
  window.fetchMatchesForRound = fetchMatchesForRound;
  window.renderMatches = renderMatches;
  window.updateRoundButtonStates = updateRoundButtonStates;
  window.addTeamSelection = addTeamSelection;
  window.removeTeamSelection = removeTeamSelection;
  window.savePrediction = savePrediction;
  window.updateStoredPrediction = updateStoredPrediction;
  window.getMatchDataById = getMatchDataById;
  window.selectUser = selectUser;
  window.formatDateToLocalTimezone = formatDateToLocalTimezone;
}
