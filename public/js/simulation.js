/**
 * Season Simulation JavaScript
 * Handles loading and displaying simulation data from the API
 */

(function() {
    'use strict';

    // State
    let simulationData = null;
    let currentSort = { column: 'premiership', direction: 'desc' };

    // DOM elements
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const summaryStats = document.getElementById('summary-stats');
    const tableContainer = document.getElementById('table-container');
    const tbody = document.getElementById('simulation-tbody');
    const yearSelect = document.getElementById('year-select');
    const ladderPositionCard = document.getElementById('ladder-position-card');
    const matrixHeader = document.getElementById('matrix-header');
    const matrixTbody = document.getElementById('matrix-tbody');

    /**
     * Initialize the page
     */
    async function init() {
        // Load available years
        await loadAvailableYears();

        // Load simulation data for selected year
        const selectedYear = yearSelect.value;
        await loadSimulationData(selectedYear);

        // Setup event listeners
        yearSelect.addEventListener('change', handleYearChange);

        // Setup table sorting
        setupTableSorting();
    }

    /**
     * Load available years with simulation data
     */
    async function loadAvailableYears() {
        try {
            const response = await fetch('/api/simulation/years');
            const data = await response.json();

            if (data.success && data.years && data.years.length > 0) {
                // Populate year select
                yearSelect.innerHTML = '';
                data.years.forEach(year => {
                    const option = document.createElement('option');
                    option.value = year;
                    option.textContent = year;
                    yearSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error loading available years:', error);
        }
    }

    /**
     * Handle year selection change
     */
    async function handleYearChange() {
        const selectedYear = yearSelect.value;
        await loadSimulationData(selectedYear);
    }

    /**
     * Load simulation data from API
     */
    async function loadSimulationData(year) {
        showLoading();

        try {
            const response = await fetch(`/api/simulation/${year}`);
            const data = await response.json();

            if (data.success) {
                simulationData = data;
                displaySimulationData();
            } else {
                showError(data.error || 'Failed to load simulation data');
            }
        } catch (error) {
            console.error('Error loading simulation data:', error);
            showError('Failed to load simulation data. Please try again later.');
        }
    }

    /**
     * Display simulation data in the UI
     */
    function displaySimulationData() {
        hideLoading();
        hideError();

        // Update page title and subtitle
        document.getElementById('simulation-title').textContent =
            `${simulationData.year} AFL Season Simulation`;
        document.getElementById('simulation-subtitle').textContent =
            `ELO-based Monte Carlo simulation • ${simulationData.completed_matches} matches completed`;

        // Update summary statistics
        document.getElementById('num-simulations').textContent =
            simulationData.num_simulations.toLocaleString();
        document.getElementById('completed-matches').textContent =
            simulationData.completed_matches;
        document.getElementById('completed-subtext').textContent =
            `${simulationData.completed_matches} matches played`;
        document.getElementById('remaining-matches').textContent =
            simulationData.remaining_matches;

        // Format last updated date
        const lastUpdated = new Date(simulationData.last_updated);
        const now = new Date();
        const diffMs = now - lastUpdated;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        let lastUpdatedText;
        if (diffMins < 60) {
            lastUpdatedText = diffMins === 0 ? 'Just now' : `${diffMins}m ago`;
        } else if (diffHours < 24) {
            lastUpdatedText = `${diffHours}h ago`;
        } else {
            lastUpdatedText = `${diffDays}d ago`;
        }

        document.getElementById('last-updated').textContent = lastUpdatedText;

        // Show summary stats and table
        summaryStats.style.display = 'grid';
        tableContainer.style.display = 'block';

        // Populate table
        populateTable();

        // Populate ladder position matrix if data is available
        populateLadderPositionMatrix();
    }

    /**
     * Populate the simulation results table
     */
    function populateTable() {
        tbody.innerHTML = '';

        // Sort the data
        const sortedResults = sortResults(simulationData.results);

        // Create table rows
        sortedResults.forEach((team, index) => {
            const row = document.createElement('tr');

            // Position
            const position = index + 1;
            const posClass = position <= 8 ? 'top8' : '';

            // Record
            const record = `${team.current_wins}-${team.current_losses}`;
            if (team.current_draws > 0) {
                record += `-${team.current_draws}`;
            }

            // Build the row HTML
            row.innerHTML = `
                <td><span class="position ${posClass}">${position}</span></td>
                <td>
                    <div class="team-cell">
                        <span>${team.team}</span>
                    </div>
                </td>
                <td><strong>${Math.round(team.current_elo)}</strong></td>
                <td><span class="record">${record}</span></td>
                <td>
                    <strong>${team.projected_wins.toFixed(1)}</strong>
                    <span class="projected">(${team.wins_10th_percentile.toFixed(1)}-${team.wins_90th_percentile.toFixed(1)})</span>
                </td>
                ${createProbabilityCell(team.finals_probability)}
                ${createProbabilityCell(team.top4_probability)}
                ${createProbabilityCell(team.prelim_probability)}
                ${createProbabilityCell(team.grand_final_probability)}
                ${createProbabilityCell(team.premiership_probability)}
            `;

            tbody.appendChild(row);
        });
    }

    /**
     * Create a probability cell with bar visualization
     */
    function createProbabilityCell(probability) {
        const percentage = (probability * 100).toFixed(1);
        const width = Math.min(probability * 100, 100);

        let barClass = 'low';
        if (probability >= 0.5) {
            barClass = 'high';
        } else if (probability >= 0.2) {
            barClass = 'medium';
        }

        const displayValue = probability < 0.01 && probability > 0 ? '<1%' : `${percentage}%`;

        return `
            <td class="prob-cell">
                <div class="prob-bar ${barClass}" style="width: ${width}%;"></div>
                <span class="prob-value">${displayValue}</span>
            </td>
        `;
    }

    /**
     * Populate the ladder position probability matrix
     */
    function populateLadderPositionMatrix() {
        // Check if ladder position data is available
        if (!simulationData || !simulationData.results || !simulationData.results[0] ||
            !simulationData.results[0].ladder_position_probabilities) {
            // Hide the ladder position card if data is not available
            ladderPositionCard.style.display = 'none';
            return;
        }

        // Show the ladder position card
        ladderPositionCard.style.display = 'block';

        // Get the number of teams
        const numTeams = simulationData.results.length;

        // Create header row
        matrixHeader.innerHTML = '<th>Team</th>';
        for (let i = 1; i <= numTeams; i++) {
            const th = document.createElement('th');
            th.textContent = i === 1 ? '1st' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`;
            matrixHeader.appendChild(th);
        }

        // Clear tbody
        matrixTbody.innerHTML = '';

        // Sort teams by current ladder position (based on projected wins)
        const sortedTeams = [...simulationData.results].sort((a, b) =>
            b.projected_wins - a.projected_wins
        );

        // Create rows for each team
        sortedTeams.forEach(team => {
            const row = document.createElement('tr');

            // Team name cell
            const nameCell = document.createElement('td');
            nameCell.className = 'team-name';
            nameCell.textContent = team.team;
            row.appendChild(nameCell);

            // Position probability cells
            for (let pos = 1; pos <= numTeams; pos++) {
                const cell = document.createElement('td');
                const probability = team.ladder_position_probabilities?.[pos] || 0;
                const percentage = (probability * 100).toFixed(0);

                // Determine cell class based on probability
                if (probability >= 0.15) {
                    cell.className = 'prob-high';
                } else if (probability >= 0.05) {
                    cell.className = 'prob-medium';
                } else if (probability > 0 && probability < 0.01) {
                    cell.className = 'prob-zero';
                    cell.textContent = '<1';
                    row.appendChild(cell);
                    continue;
                } else if (probability === 0) {
                    cell.className = 'prob-zero';
                    cell.textContent = '-';
                    row.appendChild(cell);
                    continue;
                } else {
                    cell.className = 'prob-low';
                }

                cell.textContent = percentage;
                row.appendChild(cell);
            }

            matrixTbody.appendChild(row);
        });
    }

    /**
     * Sort results based on current sort settings
     */
    function sortResults(results) {
        const sorted = [...results];
        const { column, direction } = currentSort;

        sorted.sort((a, b) => {
            let aVal, bVal;

            switch (column) {
                case 'team':
                    aVal = a.team;
                    bVal = b.team;
                    break;
                case 'elo':
                    aVal = a.current_elo;
                    bVal = b.current_elo;
                    break;
                case 'record':
                    aVal = a.current_wins;
                    bVal = b.current_wins;
                    break;
                case 'projected-wins':
                    aVal = a.projected_wins;
                    bVal = b.projected_wins;
                    break;
                case 'finals':
                    aVal = a.finals_probability;
                    bVal = b.finals_probability;
                    break;
                case 'top4':
                    aVal = a.top4_probability;
                    bVal = b.top4_probability;
                    break;
                case 'prelim':
                    aVal = a.prelim_probability;
                    bVal = b.prelim_probability;
                    break;
                case 'grand-final':
                    aVal = a.grand_final_probability;
                    bVal = b.grand_final_probability;
                    break;
                case 'premiership':
                    aVal = a.premiership_probability;
                    bVal = b.premiership_probability;
                    break;
                default:
                    return 0;
            }

            // Handle string comparison
            if (typeof aVal === 'string') {
                return direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }

            // Handle numeric comparison
            return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });

        return sorted;
    }

    /**
     * Setup table sorting functionality
     */
    function setupTableSorting() {
        const headers = document.querySelectorAll('#simulation-table th.sortable');

        headers.forEach(header => {
            header.addEventListener('click', () => {
                const sortColumn = header.dataset.sort;

                // Toggle direction if same column, otherwise default to desc
                if (currentSort.column === sortColumn) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = sortColumn;
                    currentSort.direction = 'desc';
                }

                // Update header classes
                headers.forEach(h => {
                    h.classList.remove('sorted-asc', 'sorted-desc');
                });

                header.classList.add(`sorted-${currentSort.direction}`);

                // Re-populate table with new sort
                populateTable();
            });
        });

        // Set initial sort indicator
        const defaultHeader = document.querySelector('[data-sort="premiership"]');
        if (defaultHeader) {
            defaultHeader.classList.add('sorted-desc');
        }
    }

    /**
     * Show loading indicator
     */
    function showLoading() {
        loadingIndicator.style.display = 'block';
        errorMessage.style.display = 'none';
        summaryStats.style.display = 'none';
        tableContainer.style.display = 'none';
        ladderPositionCard.style.display = 'none';
    }

    /**
     * Hide loading indicator
     */
    function hideLoading() {
        loadingIndicator.style.display = 'none';
    }

    /**
     * Show error message
     */
    function showError(message) {
        hideLoading();
        errorText.textContent = message;
        errorMessage.style.display = 'block';
        summaryStats.style.display = 'none';
        tableContainer.style.display = 'none';
        ladderPositionCard.style.display = 'none';
    }

    /**
     * Hide error message
     */
    function hideError() {
        errorMessage.style.display = 'none';
    }

    // Initialize on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
