// Predictions page JavaScript
// Initializes prediction page globals from server-rendered data attributes.

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
});
