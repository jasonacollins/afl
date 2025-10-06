// Predictions page JavaScript
// Handles team selection for 50% predictions

// Initialize window globals from data attributes
document.addEventListener('DOMContentLoaded', function() {
  const predictionsContainer = document.querySelector('.predictions-container');

  if (predictionsContainer) {
    // Get user predictions from data attribute
    const predictionsData = predictionsContainer.dataset.predictions;
    window.userPredictions = predictionsData ? JSON.parse(predictionsData) : {};

    // Get admin status from data attribute
    window.isAdmin = predictionsContainer.dataset.isAdmin === 'true';
  }

  // Add event listeners to team selection buttons
  document.querySelectorAll('.team-button[data-team]').forEach(button => {
    button.addEventListener('click', function() {
      const matchId = this.dataset.matchId;
      const team = this.dataset.team;
      selectTeam(matchId, team);
    });
  });
});

// Function to select a team for 50% predictions
function selectTeam(matchId, team) {
  const homeButton = document.querySelector(`#team-selection-${matchId} .home-team-button`);
  const awayButton = document.querySelector(`#team-selection-${matchId} .away-team-button`);
  const saveButton = document.querySelector(`.save-prediction[data-match-id="${matchId}"]`);

  if (team === 'home') {
    homeButton.classList.add('selected');
    awayButton.classList.remove('selected');
  } else {
    awayButton.classList.add('selected');
    homeButton.classList.remove('selected');
  }

  if (saveButton) {
    saveButton.dataset.tippedTeam = team;
  }
}
