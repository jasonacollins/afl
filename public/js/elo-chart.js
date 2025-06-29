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
    this.currentMode = 'year'; // 'year' or 'yearRange'
    
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
      
      this.setupEventListeners();
      console.log('Event listeners setup');
      
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
        this.currentMode = 'year';
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

  async loadEloDataForYearRange(startYear, endYear) {
    try {
      console.log(`Loading ELO data for year range ${startYear} to ${endYear}`);
      const response = await fetch(`/api/elo/ratings/range?startYear=${startYear}&endYear=${endYear}`);
      const data = await response.json();
      
      console.log('API response data points:', data.data ? data.data.length : 'no data');
      console.log('API response first 3 points:', data.data ? data.data.slice(0, 3) : 'no data');
      
      if (data.success) {
        this.chartData = data.data;
        this.teams = data.teams;
        this.yearLabels = data.yearLabels; // Store year labels for x-axis
        this.currentMode = 'yearRange';
        this.currentStartYear = startYear;
        this.currentEndYear = endYear;
        console.log('Chart data assigned - length:', this.chartData.length);
        console.log('First 3 chart data points:', this.chartData.slice(0, 3));
        console.log('Year labels:', this.yearLabels);
        console.log('All periods:', this.chartData.map(d => d.label));
      } else {
        throw new Error(data.error || 'Failed to load ELO data for year range');
      }
    } catch (error) {
      console.error('Error loading ELO data for year range:', error);
      throw error;
    }
  }

  setupEventListeners() {
    // Populate year selector
    const yearSelect = document.getElementById('year-selector');
    if (yearSelect) {
      yearSelect.innerHTML = this.availableYears.map(year => 
        `<option value="${year}" ${year === this.currentYear ? 'selected' : ''}>${year}</option>`
      ).join('');
      
      // Add event listener for year selection
      yearSelect.addEventListener('change', async (e) => {
        const selectedYear = parseInt(e.target.value);
        await this.changeYear(selectedYear);
      });
    }

    // Populate year range selectors
    this.populateYearSelectors();

    // Add event listeners for mode toggle
    const modeRadios = document.querySelectorAll('input[name="chart-mode"]');
    modeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.handleModeChange(e.target.value);
      });
    });

    // Add event listener for apply year range button
    const applyButton = document.getElementById('apply-year-range');
    if (applyButton) {
      applyButton.addEventListener('click', async () => {
        await this.applyYearRange();
      });
    }
  }

  populateYearSelectors() {
    const startYearSelect = document.getElementById('start-year');
    const endYearSelect = document.getElementById('end-year');
    
    if (startYearSelect && endYearSelect) {
      // Generate years from 1990 to current year
      const currentYear = new Date().getFullYear();
      const years = [];
      for (let year = 1990; year <= currentYear; year++) {
        years.push(year);
      }
      
      const yearOptions = years.map(year => 
        `<option value="${year}">${year}</option>`
      ).join('');
      
      startYearSelect.innerHTML = yearOptions;
      endYearSelect.innerHTML = yearOptions;
      
      // Set default values (last 5 years)
      startYearSelect.value = Math.max(1990, currentYear - 4);
      endYearSelect.value = currentYear;
    }
  }

  handleModeChange(mode) {
    const yearControls = document.getElementById('year-selector');
    const rangeControls = document.querySelectorAll('#start-year, #end-year, #apply-year-range');
    
    if (mode === 'year') {
      yearControls.disabled = false;
      rangeControls.forEach(control => control.disabled = true);
    } else {
      yearControls.disabled = true;
      rangeControls.forEach(control => control.disabled = false);
    }
  }

  async applyYearRange() {
    const startYear = parseInt(document.getElementById('start-year').value);
    const endYear = parseInt(document.getElementById('end-year').value);
    
    if (!startYear || !endYear) {
      alert('Please select both start and end years');
      return;
    }
    
    if (startYear > endYear) {
      alert('Start year must be before or equal to end year');
      return;
    }
    
    try {
      // Show loading state
      this.showLoadingState();
      
      await this.loadEloDataForYearRange(startYear, endYear);
      this.createChart();
      this.createLegend();
    } catch (error) {
      console.error('Error applying year range:', error);
      this.showError('Failed to load data for selected year range');
    }
  }

  showLoadingState() {
    const chartContainer = document.querySelector('.elo-chart-container');
    if (chartContainer) {
      chartContainer.innerHTML = '<div style="text-align: center; padding: 2rem;">Loading chart data...</div>';
    }
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
    
    try {
      // Ensure chart container exists
      let canvas = document.getElementById('elo-chart-canvas');
      if (!canvas) {
        const chartContainer = document.querySelector('.elo-chart-container');
        if (chartContainer) {
          chartContainer.innerHTML = '<canvas id="elo-chart-canvas"></canvas>';
          canvas = document.getElementById('elo-chart-canvas');
        } else {
          console.error('Chart container not found');
          this.showError('Chart container not found');
          return;
        }
      }
      
      const ctx = canvas.getContext('2d');

      if (!this.chartData || this.chartData.length === 0) {
        console.error('No chart data available');
        this.showError('No data available for the selected period');
        return;
      }

      if (!this.teams || this.teams.length === 0) {
        console.error('No teams data available');
        this.showError('No teams data available');
        return;
      }

      console.log('Chart data available:', this.chartData.length, 'data points');
      console.log('Teams available:', this.teams.length, 'teams');
      console.log('Sample chart data:', this.chartData.slice(0, 2));

    // Create custom labels for x-axis ticks based on rounds
    const rounds = [...new Set(this.chartData.map(point => point.round))].filter(r => r);
    console.log('Rounds for labels:', rounds);

    // Prepare datasets for each team with step-pattern configuration using x,y coordinates
    const datasets = this.teams.map((team, index) => {
      // Create x,y data points for this team with proper vertical alignment
      const teamData = this.chartData.map((point, pointIndex) => {
        const rating = point[team];
        // Only include data points where the team actually has a rating (played a game)
        if (rating === undefined || rating === null) {
          return null;
        }
        
        // Check if this is the start of a new season (year change)
        const isSeasonStart = this.isSeasonStart(point, pointIndex);
        
        return {
          x: point.x !== undefined ? point.x : point.step || 0,
          y: rating,
          isSeasonStart: isSeasonStart
        };
      }).filter(point => point !== null); // Filter out nulls to prevent errors

      console.log(`Team ${team} step-pattern data:`, teamData.slice(0, 5));

      const originalColor = this.teamColors[index % this.teamColors.length];
      return {
        label: team,
        data: teamData,
        borderColor: originalColor,
        backgroundColor: originalColor + '20',
        originalBorderColor: originalColor, // Store original color for reset
        borderWidth: 2,
        fill: false,
        stepped: 'after', // Enable stepped lines for box-pattern effect
        tension: 0, // Remove any curve smoothing for sharp steps
        pointRadius: 0, // Remove dots as requested
        pointHoverRadius: 4, // Small hover indication
        pointBackgroundColor: originalColor,
        pointBorderColor: originalColor,
        hidden: false,
        spanGaps: false, // Don't span gaps for proper season breaks
        segment: {
          borderColor: (ctx) => {
            // Hide line segments that cross season boundaries or show carryover adjustments
            const currentPoint = teamData[ctx.p0DataIndex];
            const nextPoint = teamData[ctx.p1DataIndex];
            
            // Check if this segment represents a carryover (seasonal adjustment)
            if (this.shouldHideCarryoverSegment(currentPoint, nextPoint)) {
              return 'transparent'; // Hide the carryover line
            }
            
            // Also hide if connecting to a new season start
            if (nextPoint && nextPoint.isSeasonStart) {
              return 'transparent';
            }
            
            // Check if this team should be highlighted or faded
            if (this.highlightedTeams.size > 0) {
              if (this.highlightedTeams.has(team)) {
                return originalColor; // Use original color for highlighted teams
              } else {
                return '#cccccc'; // Use gray for faded teams
              }
            }
            
            return originalColor;
          }
        }
      };
    });

    console.log('Created datasets:', datasets.length);

    if (datasets.length === 0) {
      console.error('No datasets created');
      this.showError('No valid datasets for chart');
      return;
    }

    console.log('Creating Chart.js instance with data:', {
      datasets: datasets.length,
      sampleDataset: datasets[0] ? {
        label: datasets[0].label,
        dataLength: datasets[0].data.length,
        sampleData: datasets[0].data.slice(0, 3)
      } : 'no datasets'
    });

    try {
      // Destroy existing chart if it exists
      if (this.chart) {
        this.chart.destroy();
      }

      this.chart = new Chart(ctx, {
        type: 'line',
        data: { 
          datasets 
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false // We'll create a custom legend
            },
            tooltip: {
              mode: 'nearest',
              intersect: true,
              callbacks: {
                title: function(context) {
                  if (context.length === 0) return '';
                  const dataPoint = context[0];
                  if (this.currentMode === 'yearRange') {
                    // Find the year from the chart data
                    const chartPoint = this.chartData[Math.floor(dataPoint.parsed.x)];
                    return chartPoint ? `Year ${chartPoint.year}` : 'Year Range';
                  } else {
                    const roundIndex = Math.floor(dataPoint.parsed.x);
                    return `Round ${rounds[roundIndex] || roundIndex + 1}`;
                  }
                }.bind(this),
                label: function(context) {
                  const teamName = context.dataset.label;
                  const rating = Math.round(context.parsed.y * 10) / 10;
                  return `${teamName}: ${rating}`;
                }
              }
            }
          },
          scales: {
            x: {
              type: 'linear',
              title: {
                display: true,
                text: this.currentMode === 'year' ? 'Round' : 'Season Progress'
              },
              grid: {
                display: this.currentMode === 'year' // Hide grid lines for year range mode
              },
              afterBuildTicks: function(axis) {
                if (this.currentMode === 'yearRange' && this.yearLabels && this.yearLabels.length > 0) {
                  // Override ticks to use exact year center positions
                  axis.ticks = this.yearLabels.map(([position, year]) => ({
                    value: position,
                    label: year.toString()
                  }));
                }
              }.bind(this),
              ticks: {
                stepSize: this.currentMode === 'yearRange' ? 10 : 1,
                callback: function(value, index, ticks) {
                  if (this.currentMode === 'yearRange') {
                    // For year range mode, labels are set by afterBuildTicks
                    // This callback shouldn't be needed, but if called, check exact matches
                    if (this.yearLabels && this.yearLabels.length > 0) {
                      for (const [position, year] of this.yearLabels) {
                        if (Math.abs(value - position) < 0.1) {
                          return year.toString();
                        }
                      }
                    }
                    return '';
                  } else {
                    // Show round labels at integer positions
                    const roundIndex = Math.floor(value);
                    return rounds[roundIndex] || '';
                  }
                }.bind(this)
              }
            },
            y: {
              title: {
                display: true,
                text: 'ELO Rating'
              },
              beginAtZero: false
            }
          },
          interaction: {
            mode: 'nearest',
            intersect: false
          }
        }
      });
      
      console.log('Chart.js instance created successfully');
      this.createLegend();
    } catch (chartError) {
      console.error('Error creating Chart.js instance:', chartError);
      console.error('Chart error stack:', chartError.stack);
      this.showError('Failed to create chart: ' + chartError.message);
      return;
    }
  } catch (error) {
    console.error('Error in createChart method:', error);
    console.error('Error stack:', error.stack);
    this.showError('Failed to create chart: ' + error.message);
  }
}

  createLegend() {
    // Create legend container if it doesn't exist
    let legendContainer = document.getElementById('elo-chart-legend');
    if (!legendContainer) {
      const chartSection = document.querySelector('.elo-chart-section');
      if (chartSection) {
        const legendDiv = document.createElement('div');
        legendDiv.id = 'elo-chart-legend';
        legendDiv.className = 'elo-chart-legend';
        chartSection.appendChild(legendDiv);
        legendContainer = legendDiv;
      } else {
        console.error('Chart section not found for legend');
        return;
      }
    }
    
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
    
    // Store current chart configuration
    const currentData = this.chartData;
    const currentTeams = this.teams;
    
    // Destroy and recreate chart to ensure proper z-order
    this.destroyChart();
    
    // Temporarily store highlight state
    const highlightedTeams = new Set(this.highlightedTeams);
    
    // Recreate chart with proper ordering
    this.createChartWithHighlights(currentData, currentTeams, highlightedTeams);
  }

  createChartWithHighlights(chartData, teams, highlightedTeams) {
    if (!chartData || !teams) {
      console.error('No chart data available for highlighting');
      return;
    }

    // Ensure chart container exists
    let canvas = document.getElementById('elo-chart-canvas');
    if (!canvas) {
      const chartContainer = document.querySelector('.elo-chart-container');
      if (chartContainer) {
        chartContainer.innerHTML = '<canvas id="elo-chart-canvas"></canvas>';
        canvas = document.getElementById('elo-chart-canvas');
      } else {
        console.error('Chart container not found');
        return;
      }
    }
    
    const ctx = canvas.getContext('2d');

    // Create rounds for x-axis labels
    const rounds = [...new Set(chartData.map(point => point.round))].filter(r => r);

    // Separate teams into highlighted and faded, with highlighted teams last (front)
    const fadedTeams = teams.filter(team => !highlightedTeams.has(team));
    const highlightedTeamsList = teams.filter(team => highlightedTeams.has(team));
    // Put highlighted teams FIRST so they render last (on top)
    const orderedTeams = [...highlightedTeamsList, ...fadedTeams];

    // Create datasets with proper z-order
    const datasets = orderedTeams.map((team, index) => {
      const teamData = chartData.map((point, pointIndex) => {
        const rating = point[team];
        // Only include data points where the team actually has a rating (played a game)
        if (rating === undefined || rating === null) {
          return null;
        }
        
        const isSeasonStart = this.isSeasonStart(point, pointIndex);
        
        return {
          x: point.x !== undefined ? point.x : point.step || 0,
          y: rating,
          isSeasonStart: isSeasonStart
        };
      }).filter(point => point !== null);

      const originalColor = this.teamColors[teams.indexOf(team) % this.teamColors.length];
      const isHighlighted = highlightedTeams.has(team);
      
      return {
        label: team,
        data: teamData,
        borderColor: isHighlighted ? originalColor : '#cccccc',
        backgroundColor: isHighlighted ? (originalColor + '30') : '#cccccc10',
        originalBorderColor: originalColor,
        borderWidth: isHighlighted ? 4 : 1,
        fill: false,
        stepped: 'after',
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: isHighlighted ? originalColor : '#cccccc',
        pointBorderColor: isHighlighted ? originalColor : '#cccccc',
        hidden: false,
        spanGaps: false,
        order: isHighlighted ? 0 : 10, // Lower order = rendered on top
        segment: {
          borderColor: (ctx) => {
            const currentPoint = teamData[ctx.p0DataIndex];
            const nextPoint = teamData[ctx.p1DataIndex];
            
            if (this.shouldHideCarryoverSegment(currentPoint, nextPoint)) {
              return 'transparent';
            }
            
            if (nextPoint && nextPoint.isSeasonStart) {
              return 'transparent';
            }
            
            return isHighlighted ? originalColor : '#cccccc';
          }
        }
      };
    });

    // Create new chart
    this.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        datasets: {
          line: {
            order: 1 // Default order for all line datasets
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            mode: 'nearest',
            intersect: true,
            callbacks: {
              title: function(context) {
                if (context.length === 0) return '';
                const dataPoint = context[0];
                if (this.currentMode === 'yearRange') {
                  // Find the year from the chart data
                  const chartPoint = chartData[Math.floor(dataPoint.parsed.x)];
                  return chartPoint ? `Year ${chartPoint.year}` : 'Year Range';
                } else {
                  const roundIndex = Math.floor(dataPoint.parsed.x);
                  return `Round ${rounds[roundIndex] || roundIndex + 1}`;
                }
              }.bind(this),
              label: function(context) {
                const teamName = context.dataset.label;
                const rating = Math.round(context.parsed.y * 10) / 10;
                return `${teamName}: ${rating}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: this.currentMode === 'year' ? 'Round' : 'Season Progress'
            },
            grid: {
              display: this.currentMode === 'year' // Hide grid lines for year range mode
            },
            afterBuildTicks: function(axis) {
              if (this.currentMode === 'yearRange' && this.yearLabels && this.yearLabels.length > 0) {
                // Override ticks to use exact year center positions
                axis.ticks = this.yearLabels.map(([position, year]) => ({
                  value: position,
                  label: year.toString()
                }));
              }
            }.bind(this),
            ticks: {
              stepSize: this.currentMode === 'yearRange' ? 10 : 1,
              callback: function(value, index, ticks) {
                if (this.currentMode === 'yearRange') {
                  // For year range mode, labels are set by afterBuildTicks
                  // This callback shouldn't be needed, but if called, check exact matches
                  if (this.yearLabels && this.yearLabels.length > 0) {
                    for (const [position, year] of this.yearLabels) {
                      if (Math.abs(value - position) < 0.1) {
                        return year.toString();
                      }
                    }
                  }
                  return '';
                } else {
                  // Show round labels at integer positions
                  const roundIndex = Math.floor(value);
                  return rounds[roundIndex] || '';
                }
              }.bind(this)
            }
          },
          y: {
            title: {
              display: true,
              text: 'ELO Rating'
            },
            beginAtZero: false
          }
        },
        interaction: {
          mode: 'nearest',
          intersect: false
        }
      }
    });

    // Restore highlight state
    this.highlightedTeams = highlightedTeams;
    this.createLegend();
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

  /**
   * Check if a data point represents the start of a new season
   * @param {Object} point - Current data point
   * @param {number} pointIndex - Index of current point
   * @returns {boolean} True if this is the start of a new season
   */
  isSeasonStart(point, pointIndex) {
    if (pointIndex === 0) return false; // First point can't be a season start
    
    const previousPoint = this.chartData[pointIndex - 1];
    
    // Check if year has changed
    if (point.year && previousPoint.year && point.year !== previousPoint.year) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a line segment should be hidden due to carryover (end of season to start of next)
   * @param {Object} currentPoint - Current data point
   * @param {Object} nextPoint - Next data point  
   * @returns {boolean} True if this segment should be hidden
   */
  shouldHideCarryoverSegment(currentPoint, nextPoint) {
    if (!currentPoint || !nextPoint) return false;
    
    // Find the chart data points corresponding to these coordinates
    const currentDataPoint = this.chartData.find(d => d.x === currentPoint.x);
    const nextDataPoint = this.chartData.find(d => d.x === nextPoint.x);
    
    if (!currentDataPoint || !nextDataPoint) return false;
    
    // Hide segments from end of season to start of next season
    if (currentDataPoint.year && nextDataPoint.year && currentDataPoint.year !== nextDataPoint.year) {
      return true; // Always hide cross-season segments
    }
    
    // Hide horizontal segments that extend from the final "after_game" point of any season
    // This prevents the trailing horizontal line after Grand Final
    if (currentDataPoint.type === 'after_game') {
      // Check if this is the last "after_game" point in the season
      const currentIndex = this.chartData.findIndex(d => 
        d.x === currentPoint.x && 
        d.type === 'after_game'
      );
      
      if (currentIndex >= 0) {
        // Look for any more data points in this season after the current point
        const laterPointsInSeason = this.chartData.slice(currentIndex + 1)
          .filter(d => d.year === currentDataPoint.year);
        
        if (laterPointsInSeason.length === 0) {
          // This is the final after_game point of the season - hide horizontal segment
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Create separate datasets for each season to ensure gaps between seasons
   * @param {Array} teamData - Array of team data points
   * @param {string} team - Team name
   * @param {string} originalColor - Team color
   * @returns {Array} Array of dataset objects (one per season)
   */
  createSeasonDatasets(teamData, team, originalColor) {
    if (!teamData || teamData.length === 0) return [];
    
    const seasonDatasets = [];
    let currentSeasonData = [];
    let currentYear = null;
    
    for (let i = 0; i < teamData.length; i++) {
      const point = teamData[i];
      const pointYear = this.chartData.find(d => d.x === point.x)?.year;
      
      // If year changed and we have data, finish current season
      if (pointYear !== currentYear && currentSeasonData.length > 0) {
        seasonDatasets.push(this.createSeasonDataset(currentSeasonData, team, originalColor, currentYear));
        currentSeasonData = [];
      }
      
      currentYear = pointYear;
      currentSeasonData.push(point);
    }
    
    // Add the last season
    if (currentSeasonData.length > 0) {
      seasonDatasets.push(this.createSeasonDataset(currentSeasonData, team, originalColor, currentYear));
    }
    
    return seasonDatasets;
  }
  
  /**
   * Create a single season dataset
   * @param {Array} seasonData - Data points for this season
   * @param {string} team - Team name
   * @param {string} originalColor - Team color
   * @param {number} year - Season year
   * @returns {Object} Dataset object for this season
   */
  createSeasonDataset(seasonData, team, originalColor, year) {
    return {
      label: `${team}`, // Keep same label for legend grouping
      data: seasonData,
      borderColor: originalColor,
      backgroundColor: originalColor + '20',
      originalBorderColor: originalColor,
      borderWidth: 2,
      fill: false,
      stepped: 'after',
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: originalColor,
      pointBorderColor: originalColor,
      hidden: false,
      spanGaps: false,
      teamName: team, // Store team name for legend handling
      seasonYear: year // Store year for debugging
    };
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