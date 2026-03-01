// Homepage JavaScript functionality - extracted from inline script for CSP compliance

function getSelectedPerformanceYear() {
  const yearSelector = document.getElementById('performance-year-selector');
  if (yearSelector && yearSelector.value) {
    return yearSelector.value;
  }

  return String(new Date().getFullYear());
}

function getFeaturedPredictorId() {
  const performanceCard = document.querySelector('.performance-card');
  if (!performanceCard) {
    return null;
  }

  return performanceCard.dataset.featuredPredictorId || null;
}

function fetchRoundPredictions(round) {
  // Update active button
  document.querySelectorAll('.round-button').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.round === round);
  });
  
  // Show loading state
  document.getElementById('predictions-table-container').innerHTML = 
    '<div style="text-align: center; padding: 2rem;">Loading predictions...</div>';
  
  const selectedPredictorId = getFeaturedPredictorId();
  
  // Always use the homepage performance year selector for featured predictions.
  const selectedYear = getSelectedPerformanceYear();
  
  // Fetch predictions for this round and predictor
  const queryParams = new URLSearchParams({ year: selectedYear });
  if (selectedPredictorId) {
    queryParams.set('predictorId', selectedPredictorId);
  }

  fetch(`/featured-predictions/${encodeURIComponent(round)}?${queryParams.toString()}`)
    .then(response => response.json())
    .then(data => {
      renderPredictionsTable(data.matches, data.predictions);
    })
    .catch(error => {
      console.error('Error fetching predictions:', error);
      document.getElementById('predictions-table-container').innerHTML = 
        '<div style="text-align: center; padding: 2rem; color: #666;">Error loading predictions</div>';
    });
}

function renderPredictionsTable(matches, predictions) {
  let tableHtml = `
    <table class="predictions-table">
      <thead>
        <tr>
        <th style="text-align: left;">Match</th>
        <th style="text-align: center;">Result</th>
        <th style="text-align: center;">Prediction</th>
        <th style="text-align: center;">Win accuracy</th>
        <th style="text-align: center;">Predicted margin</th>
        <th style="text-align: center;">Margin error</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  if (matches && matches.length > 0) {
    matches.forEach(match => {
      // Format match date if available
      let matchDate = match.match_date;
      if (matchDate && matchDate.includes('T')) {
        try {
          const date = new Date(matchDate);
          matchDate = date.toLocaleDateString('en-AU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });
        } catch (e) {
          console.error('Error formatting date:', e);
        }
      }
      
      // Get prediction
      let predictionHtml = 'No prediction';
      if (predictions[match.match_id]) {
      const prediction = predictions[match.match_id];
      let probability;
      let tippedTeam;
    
      if (typeof prediction === 'object') {
      probability = prediction.probability;
        tippedTeam = prediction.tipped_team;
      } else {
        probability = prediction;
        tippedTeam = null;
      }
    
      if (probability > 50) {
        predictionHtml = `${probability}% ${match.home_team}`;
      } else if (probability < 50) {
        predictionHtml = `${100 - probability}% ${match.away_team}`;
      } else { // exactly 50%
        if (tippedTeam) {
          predictionHtml = `50% draw (tipped: ${tippedTeam === 'home' ? match.home_team : match.away_team})`;
        } else {
         predictionHtml = `50% draw`;
        }
       }
     }
      
      // Result
      let resultHtml = 'Upcoming';
      if (match.hscore !== null && match.ascore !== null) {
        resultHtml = `${match.hscore} - ${match.ascore}`;
      }
      
      // Win Accuracy
      let winAccuracyHtml = '-';
      if (match.hscore !== null && match.ascore !== null && 
          predictions[match.match_id] && match.metrics) {
        
        if (match.metrics.correct) {
          winAccuracyHtml = `<span class="correct">✓ Correct</span>`;
        } else if (match.metrics.partial) {
          winAccuracyHtml = `<span class="partial">◑ Draw</span>`;
        } else {
          winAccuracyHtml = `<span class="incorrect">✗ Incorrect</span>`;
        }
      }
      
      // Predicted margin
      let predictedMarginHtml = '-';
      if (predictions[match.match_id] && predictions[match.match_id].predicted_margin !== null) {
        predictedMarginHtml = predictions[match.match_id].predicted_margin;
      }
      
      // Margin error
      let marginErrorHtml = '-';
      if (match.hscore !== null && match.ascore !== null && 
          predictions[match.match_id] && 
          predictions[match.match_id].predicted_margin !== null) {
        const actualMargin = match.hscore - match.ascore;
        const predictedMargin = predictions[match.match_id].predicted_margin;
        const marginError = Math.abs(actualMargin - predictedMargin);
        marginErrorHtml = marginError.toFixed(1);
      }
      
      tableHtml += `
        <tr>
          <td style="text-align: left;">
            <div class="match-info">
              <div class="teams">${match.home_team} vs ${match.away_team}</div>
              <div class="match-details">${matchDate} • ${match.venue}</div>
            </div>
          </td>
          <td style="text-align: center;">${resultHtml}</td>
          <td style="text-align: center;">${predictionHtml}</td>
          <td style="text-align: center;">${winAccuracyHtml}</td>
          <td style="text-align: center;">${predictedMarginHtml}</td>
          <td style="text-align: center;">${marginErrorHtml}</td>
        </tr>
      `;
    });
  } else {
    tableHtml += `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2rem; color: #666;">
          No matches available for this round
        </td>
      </tr>
    `;
  }
  
  tableHtml += `
      </tbody>
    </table>
  `;
  
  document.getElementById('predictions-table-container').innerHTML = tableHtml;
}

// Function to update performance card when year or predictor changes
function updatePerformanceData(selectedYear = null, selectedPredictorId = null) {
  const container = document.getElementById('performance-metrics-container');
  if (!container) return;
  
  const currentYear = selectedYear || getSelectedPerformanceYear();
  const predictorId = selectedPredictorId || getFeaturedPredictorId();
  
  if (!predictorId) {
    console.warn('No predictor ID available for performance update');
    return;
  }
  
  fetch(`/api/predictor-stats?predictorId=${predictorId}&year=${currentYear}`)
    .then(response => response.json())
    .then(data => {
      if (data.success && data.stats) {
        updateStatsDisplay(data.stats);
      } else {
        console.warn('No stats data available:', data);
      }
    })
    .catch(error => {
      console.error('Error fetching predictor stats:', error);
    });
}

function updateStatsDisplay(stats) {
  const container = document.querySelector('.performance-metrics');
  if (!container) return;
  
  const metricsHtml = `
    <div class="metric">
      <div class="metric-label">Tip Accuracy</div>
      <div class="metric-value">${stats.tipAccuracy}%</div>
      <div class="metric-detail">${stats.tipPoints}/${stats.totalPredictions}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Brier Score</div>
      <div class="metric-value">${stats.brierScore}</div>
      <div class="metric-detail">Lower is better</div>
    </div>
    <div class="metric">
      <div class="metric-label">Bits Score</div>
      <div class="metric-value">${stats.bitsScore}</div>
      <div class="metric-detail">Higher is better</div>
    </div>
    <div class="metric">
      <div class="metric-label">Margin MAE</div>
      <div class="metric-value">${stats.marginMAE !== null ? stats.marginMAE : '-'}</div>
      <div class="metric-detail">${stats.marginMAE !== null ? 'Lower is better' : 'No margin predictions'}</div>
    </div>
  `;
  
  container.innerHTML = metricsHtml;
}

// Initialize event listeners when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Add event listeners to round buttons
  document.querySelectorAll('.round-button').forEach(button => {
    button.addEventListener('click', function() {
      const round = this.dataset.round;
      fetchRoundPredictions(round);
    });
  });
  
  // Add event listener to performance year selector if it exists
  const performanceYearSelector = document.getElementById('performance-year-selector');
  if (performanceYearSelector) {
    performanceYearSelector.addEventListener('change', function() {
      const selectedRound = document.querySelector('.round-button.selected');
      updatePerformanceData(this.value);
      if (selectedRound) {
        fetchRoundPredictions(selectedRound.dataset.round);
      }
    });
  }
});
