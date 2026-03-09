// Stats page JavaScript
// Handles checkbox exclusions and round statistics loading

let currentSelectedYear;
let currentUserId;
let excludedPredictors = new Set();

function formatRoundDisplay(roundNumber) {
  if (roundNumber === 'OR') {
    return 'Opening Round';
  }

  return isNaN(roundNumber) ? roundNumber : `Round ${roundNumber}`;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
  // Get values from data attributes
  const statsContainer = document.querySelector('.stats-container');
  if (statsContainer) {
    currentSelectedYear = parseInt(statsContainer.dataset.year);
    currentUserId = parseInt(statsContainer.dataset.userId);
  }

  // Load saved exclusions on page load for all users
  await loadSavedExclusions();

  // Add event listeners to round buttons
  document.querySelectorAll('.round-button').forEach(button => {
    button.addEventListener('click', function() {
      const round = this.dataset.round;
      loadRoundStats(round);
    });
  });

  // Add event listeners to checkboxes for real-time updates (admin only)
  document.querySelectorAll('.exclude-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async function() {
      const predictorId = this.dataset.predictorId;
      console.log('Checkbox changed for predictor:', predictorId, 'checked:', this.checked);

      if (this.checked) {
        excludedPredictors.add(predictorId);
      } else {
        excludedPredictors.delete(predictorId);
      }

      console.log('Current excluded predictors:', [...excludedPredictors]);

      // Save immediately on checkbox change
      const saved = await saveExclusions();

      // Only reload if save was successful
      if (saved !== false) {
        console.log('Reloading page to show updated statistics');
        window.location.reload();
      }
    });
  });
});

// Load saved exclusions from server
async function loadSavedExclusions() {
  try {
    const response = await fetch('/api/excluded-predictors');
    const data = await response.json();

    if (data.excludedPredictors) {
      excludedPredictors = new Set(data.excludedPredictors);

      // Update checkbox states (only for admins)
      document.querySelectorAll('.exclude-checkbox').forEach(checkbox => {
        checkbox.checked = excludedPredictors.has(checkbox.dataset.predictorId);
      });

      // No need to apply exclusions since server handles filtering
    }
  } catch (error) {
    console.error('Error loading saved exclusions:', error);
  }
}

// Get CSRF token from meta tag
function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

// Save exclusions to server (admin only)
async function saveExclusions() {
  try {
    const predictorIdsArray = [...excludedPredictors];
    console.log('Saving exclusions:', predictorIdsArray);

    const response = await fetch('/admin/api/excluded-predictors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({ predictorIds: predictorIdsArray })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to save exclusions:', response.status, errorText);
      alert(`Failed to save exclusions: ${response.status}`);
      return false;
    }

    const result = await response.json();
    console.log('Exclusions saved successfully:', result);
    return true;
  } catch (error) {
    console.error('Error saving exclusions:', error);
    alert(`Error saving exclusions: ${error.message}`);
    return false;
  }
}

function loadRoundStats(roundNumber) {
  // Update button selection
  document.querySelectorAll('.round-button').forEach(btn => {
    btn.classList.remove('selected');
  });
  const selectedButton = document.querySelector(`[data-round="${roundNumber}"]`);
  if (selectedButton) {
    selectedButton.classList.add('selected');
  }

  // Show loading state
  const roundContainer = document.getElementById('round-stats-container');
  const roundContent = document.getElementById('round-stats-content');
  const roundDisplay = document.getElementById('round-display');

  // Show container and update round display
  roundContainer.style.display = 'block';
  roundDisplay.textContent = formatRoundDisplay(roundNumber);

  // Show loading
  roundContent.innerHTML = '<div class="loading">Loading round statistics...</div>';

  // Fetch round data
  fetch(`/matches/stats/round/${encodeURIComponent(roundNumber)}?year=${currentSelectedYear}`)
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        updateRoundStatsTable(data);
      } else {
        roundContent.innerHTML = '<div class="no-stats"><p>Error loading round statistics.</p></div>';
      }
    })
    .catch(error => {
      console.error('Error loading round stats:', error);
      roundContent.innerHTML = '<div class="no-stats"><p>Error loading round statistics.</p></div>';
    });
}

function updateRoundStatsTable(data) {
  const roundContent = document.getElementById('round-stats-content');

  if (!data.roundPredictorStats || data.roundPredictorStats.length === 0 ||
      data.roundPredictorStats.every(stat => stat.totalPredictions === 0)) {
    roundContent.innerHTML = '<div class="no-stats"><p>No prediction results available for this round.</p></div>';
    return;
  }

  let tableHTML = `
    <table class="stats-table stack-mobile">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th>Brier Score</th>
          <th>Bits Score</th>
          <th>Correct Tips</th>
          <th>Total Tips</th>
          <th>Tip Accuracy</th>
          <th>Margin MAE</th>
        </tr>
      </thead>
      <tbody>`;

  let rank = 1;
  data.roundPredictorStats.forEach(stats => {
    if (stats.totalPredictions > 0) {
      const isCurrentUser = stats.id === currentUserId;
      tableHTML += `
        <tr class="${isCurrentUser ? 'current-user' : ''}">
          <td data-label="Rank">${rank++}</td>
          <td class="stack-primary" data-label="Name">${stats.display_name} ${isCurrentUser ? '(You)' : ''}</td>
          <td data-label="Brier Score">${stats.brierScore}</td>
          <td data-label="Bits Score">${stats.bitsScore}</td>
          <td data-label="Correct Tips">${stats.tipPoints}</td>
          <td data-label="Total Tips">${stats.totalPredictions}</td>
          <td data-label="Tip Accuracy">${stats.tipAccuracy}%</td>
          <td data-label="Margin MAE">${stats.marginMAE !== null ? stats.marginMAE : '-'}</td>
        </tr>`;
    }
  });

  tableHTML += `
      </tbody>
    </table>`;

  roundContent.innerHTML = tableHTML;

  // Server handles exclusions, no need to apply client-side
}
