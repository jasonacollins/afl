/**
 * ELO Chart Component
 * Interactive chart showing AFL team ELO ratings over time
 */
class EloChart {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.chart = null;
    this.currentYear = options.defaultYear || new Date().getFullYear();
    this.availableYears = [];
    this.chartData = null;
    this.teams = [];
    this.highlightedTeams = new Set();
    
    // Chart colors - bold, vibrant colors that stand out against gray
    this.teamColors = [
      '#FF0000', '#00AA00', '#0066FF', '#FF6600', '#9900CC', '#FF1493', 
      '#00CCCC', '#FFD700', '#8B0000', '#228B22', '#000080', '#FF4500',
      '#800080', '#DC143C', '#006400', '#4169E1', '#B22222', '#2E8B57'
    ];
    
    this.init();
  }

  async init() {
    try {
      console.log('Initializing ELO chart...');
      await this.loadAvailableYears();
      console.log('Available years loaded:', this.availableYears);
      
      this.createChartContainer();
      console.log('Chart container created');
      
      await this.loadEloData(this.currentYear);
      console.log('ELO data loaded for year:', this.currentYear);
      
      this.createChart();
      console.log('Chart creation complete');
    } catch (error) {
      console.error('Failed to initialize ELO chart:', error);
      this.showError('Failed to load ELO chart data');
    }
  }

  async loadAvailableYears() {
    try {
      const response = await fetch('/api/elo/years');
      const data = await response.json();
      
      if (data.success) {
        this.availableYears = data.years;
        // Set current year to latest available if current year not available
        if (!this.availableYears.includes(this.currentYear) && this.availableYears.length > 0) {
          this.currentYear = this.availableYears[0];
        }
      } else {
        throw new Error(data.error || 'Failed to load available years');
      }
    } catch (error) {
      console.error('Error loading available years:', error);
      this.availableYears = [this.currentYear]; // Fallback
    }
  }

  async loadEloData(year) {
    try {
      console.log(`Loading ELO data for year ${year}`);
      const response = await fetch(`/api/elo/ratings/${year}`);
      const data = await response.json();
      
      console.log('API response data points:', data.data ? data.data.length : 'no data');
      console.log('API response first 3 points:', data.data ? data.data.slice(0, 3) : 'no data');
      console.log('Raw API URL:', `/api/elo/ratings/${year}`);
      
      if (data.success) {
        this.chartData = data.data;
        this.teams = data.teams;
        this.currentYear = year;
        console.log('Chart data assigned - length:', this.chartData.length);
        console.log('First 3 chart data points:', this.chartData.slice(0, 3));
        console.log('All rounds:', this.chartData.map(d => d.round));
      } else {
        throw new Error(data.error || 'Failed to load ELO data');
      }
    } catch (error) {
      console.error('Error loading ELO data:', error);
      throw error;
    }
  }

  createChartContainer() {
    this.container.innerHTML = `
      <div class="elo-chart-section">
        <div class="elo-chart-header">
          <h2>AFL Team ELO Ratings</h2>
          <div class="elo-chart-controls">
            <label for="elo-year-select">Year:</label>
            <select id="elo-year-select" class="elo-year-selector">
              ${this.availableYears.map(year => 
                `<option value="${year}" ${year === this.currentYear ? 'selected' : ''}>${year}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="elo-chart-container">
          <canvas id="elo-chart-canvas"></canvas>
        </div>
        <div class="elo-chart-legend" id="elo-chart-legend">
          <!-- Legend will be populated dynamically -->
        </div>
        <div class="elo-chart-info">
          <p><small>Click on team names in the legend to highlight/hide teams. ELO ratings show team strength over time.</small></p>
        </div>
      </div>
    `;

    // Add event listener for year selection
    const yearSelect = document.getElementById('elo-year-select');
    yearSelect.addEventListener('change', async (e) => {
      const selectedYear = parseInt(e.target.value);
      await this.changeYear(selectedYear);
    });
  }

  async changeYear(year) {
    try {
      // Show loading state
      const canvas = document.getElementById('elo-chart-canvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '16px Arial';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);

      await this.loadEloData(year);
      this.destroyChart();
      this.createChart();
      this.createLegend();
    } catch (error) {
      console.error('Error changing year:', error);
      this.showError(`Failed to load data for ${year}`);
    }
  }

  createChart() {
    console.log('Creating chart...');
    const canvas = document.getElementById('elo-chart-canvas');
    const ctx = canvas.getContext('2d');

    if (!this.chartData || this.chartData.length === 0) {
      console.error('No chart data available');
      this.showError('No data available for the selected year');
      return;
    }

    console.log('Chart data available:', this.chartData.length, 'rounds');

    // Get all rounds for x-axis labels
    const rounds = this.chartData.map(point => point.round);
    console.log('Rounds:', rounds);

    // Prepare datasets for each team
    const datasets = this.teams.map((team, index) => {
      // Create data points for this team across all rounds
      const teamData = this.chartData.map((point) => {
        return point[team] || null;
      });

      console.log(`Team ${team} data:`, teamData);

      const originalColor = this.teamColors[index % this.teamColors.length];
      return {
        label: team,
        data: teamData,
        borderColor: originalColor,
        backgroundColor: originalColor + '20',
        originalBorderColor: originalColor, // Store original color for reset
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        pointRadius: 3,
        pointHoverRadius: 6,
        hidden: false,
        spanGaps: true // Connect points even if some data is missing
      };
    });

    console.log('Created datasets:', datasets.length);

    console.log('Creating Chart.js instance with data:', {
      labels: rounds,
      datasets: datasets.length
    });

    try {
      this.chart = new Chart(ctx, {
        type: 'line',
        data: { 
          labels: rounds,
          datasets 
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false // We'll create a custom legend
            }
          },
          scales: {
            x: {
              type: 'category',
              title: {
                display: true,
                text: 'Round'
              }
            },
            y: {
              title: {
                display: true,
                text: 'ELO Rating'
              },
              beginAtZero: false
            }
          }
        }
      });
      
      console.log('Chart.js instance created successfully');
    } catch (chartError) {
      console.error('Error creating Chart.js instance:', chartError);
      this.showError('Failed to create chart: ' + chartError.message);
      return;
    }

    this.createLegend();
  }

  createLegend() {
    const legendContainer = document.getElementById('elo-chart-legend');
    
    const legendItems = this.teams.map((team, index) => {
      const color = this.teamColors[index % this.teamColors.length];
      const isHighlighted = this.highlightedTeams.has(team);
      const isHidden = this.chart.getDatasetMeta(index).hidden;
      
      return `
        <div class="legend-item ${isHighlighted ? 'highlighted' : ''} ${isHidden ? 'hidden' : ''}" 
             data-team="${team}" data-index="${index}">
          <span class="legend-color" style="background-color: ${color}"></span>
          <span class="legend-label">${team}</span>
        </div>
      `;
    }).join('');

    legendContainer.innerHTML = `
      <div class="legend-grid">
        ${legendItems}
      </div>
    `;

    // Remove any existing event listeners and add new ones
    const legendGrid = legendContainer.querySelector('.legend-grid');
    legendGrid.addEventListener('click', (e) => {
      const legendItem = e.target.closest('.legend-item');
      if (legendItem) {
        const team = legendItem.dataset.team;
        const index = parseInt(legendItem.dataset.index);
        
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd + click to add/remove from selection
          this.toggleTeamHighlight(team);
        } else {
          // Regular click to select only this team
          this.selectTeamExclusive(team);
        }
      }
    });
  }

  selectTeamExclusive(team) {
    console.log('selectTeamExclusive called for team:', team);
    console.log('Current highlighted teams:', Array.from(this.highlightedTeams));
    
    if (this.highlightedTeams.size === 1 && this.highlightedTeams.has(team)) {
      // If only this team is selected, deselect it (clear selection)
      console.log('Clearing selection (same team clicked)');
      this.highlightedTeams.clear();
    } else {
      // Select only this team
      console.log('Selecting team exclusively:', team);
      this.highlightedTeams.clear();
      this.highlightedTeams.add(team);
    }
    
    console.log('New highlighted teams:', Array.from(this.highlightedTeams));
    this.updateChartHighlights();
    this.updateLegendVisualState();
  }

  toggleTeamHighlight(team) {
    if (this.highlightedTeams.has(team)) {
      this.highlightedTeams.delete(team);
    } else {
      this.highlightedTeams.add(team);
    }
    this.updateChartHighlights();
    this.updateLegendVisualState();
  }

  updateLegendVisualState() {
    // Update legend visual state without rebuilding
    const legendItems = document.querySelectorAll('.legend-item');
    legendItems.forEach(item => {
      const team = item.dataset.team;
      const isHighlighted = this.highlightedTeams.has(team);
      
      if (isHighlighted) {
        item.classList.add('highlighted');
      } else {
        item.classList.remove('highlighted');
      }
    });
  }

  toggleTeamVisibility(datasetIndex) {
    const meta = this.chart.getDatasetMeta(datasetIndex);
    meta.hidden = !meta.hidden;
    this.chart.update();
    this.createLegend(); // This one needs full rebuild to update hidden state
  }

  updateChartHighlights() {
    console.log('updateChartHighlights called with highlighted teams:', Array.from(this.highlightedTeams));
    
    if (this.highlightedTeams.size === 0) {
      // No highlights - show all teams normally
      console.log('No highlights - showing all teams normally');
      this.chart.data.datasets.forEach(dataset => {
        dataset.borderWidth = 2;
        dataset.borderColor = dataset.originalBorderColor;
        dataset.backgroundColor = dataset.originalBorderColor + '20';
      });
    } else {
      // Highlight selected teams, fade others to light gray
      console.log('Applying highlights...');
      this.chart.data.datasets.forEach(dataset => {
        if (this.highlightedTeams.has(dataset.label)) {
          console.log('Highlighting team:', dataset.label);
          dataset.borderWidth = 4; // Even thicker for more prominence
          dataset.borderColor = dataset.originalBorderColor;
          dataset.backgroundColor = dataset.originalBorderColor + '30';
        } else {
          console.log('Fading team to gray:', dataset.label);
          dataset.borderWidth = 1;
          dataset.borderColor = '#dddddd'; // Lighter gray for more contrast
          dataset.backgroundColor = '#dddddd15'; // Very light gray with transparency
        }
      });
    }
    this.chart.update();
  }

  showError(message) {
    this.container.innerHTML = `
      <div class="elo-chart-error">
        <h3>ELO Chart Error</h3>
        <p>${message}</p>
      </div>
    `;
  }

  destroyChart() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  destroy() {
    this.destroyChart();
    this.container.innerHTML = '';
  }
}

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const chartContainer = document.getElementById('elo-chart');
  if (chartContainer) {
    window.eloChart = new EloChart('elo-chart');
  }
});