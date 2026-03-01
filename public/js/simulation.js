/**
 * Season Simulation JavaScript
 * Handles loading and displaying simulation data from the API
 */

(function() {
    'use strict';

    // State
    let simulationData = null;
    let roundSnapshots = [];
    let activeSnapshot = null;
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
    const roundSnapshotNav = document.getElementById('round-snapshot-nav');
    const roundTabsContainer = document.getElementById('round-tabs');
    const roundSnapshotContext = document.getElementById('round-snapshot-context');

    // Color palette for probability visualization (low → high)
    const PROBABILITY_COLOR_STOPS = [
        { stop: 0.0, color: [255, 255, 255] },   // 0% -> white
        { stop: 0.3, color: [224, 242, 255] },   // pale glacier
        { stop: 0.6, color: [59, 130, 246] },    // saturated blue
        { stop: 1.0, color: [31, 94, 191] }      // rich sapphire
    ];

    const WHITE_COLOR = [255, 255, 255];
    const TABLE_COLOR_BLEND = { min: 0.15, max: 1, power: 0.65 };
    const MATRIX_COLOR_BLEND = { min: 0.12, max: 0.95, power: 0.75 };

    function interpolateColor(colorA, colorB, t) {
        const clampedT = Math.max(0, Math.min(t, 1));
        return [
            Math.round(colorA[0] + (colorB[0] - colorA[0]) * clampedT),
            Math.round(colorA[1] + (colorB[1] - colorA[1]) * clampedT),
            Math.round(colorA[2] + (colorB[2] - colorA[2]) * clampedT)
        ];
    }

    function getProbabilityColor(probability) {
        const clamped = Math.max(0, Math.min(probability, 1));

        for (let i = 0; i < PROBABILITY_COLOR_STOPS.length - 1; i++) {
            const current = PROBABILITY_COLOR_STOPS[i];
            const next = PROBABILITY_COLOR_STOPS[i + 1];

            if (clamped >= current.stop && clamped <= next.stop) {
                const segmentRange = next.stop - current.stop;
                const localT = segmentRange === 0 ? 0 : (clamped - current.stop) / segmentRange;
                return interpolateColor(current.color, next.color, localT);
            }
        }

        return PROBABILITY_COLOR_STOPS[PROBABILITY_COLOR_STOPS.length - 1].color;
    }

    function getContrastTextColor(rgb) {
        const [r, g, b] = rgb.map(value => {
            const channel = value / 255;
            return channel <= 0.03928
                ? channel / 12.92
                : Math.pow((channel + 0.055) / 1.055, 2.4);
        });

        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance > 0.55 ? '#1b1b1b' : '#ffffff';
    }

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
                const currentlySelectedYear = yearSelect.value;

                // Populate year select
                yearSelect.innerHTML = '';
                data.years.forEach(year => {
                    const option = document.createElement('option');
                    option.value = year;
                    option.textContent = year;
                    if (String(year) === String(currentlySelectedYear)) {
                        option.selected = true;
                    }
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

        // Update page title
        document.getElementById('simulation-title').textContent =
            `${simulationData.year} AFL Season Simulation`;

        initializeRoundSnapshots();
        renderRoundTabs();

        if (!activeSnapshot) {
            showError('Simulation snapshot data is missing or invalid.');
            return;
        }

        displayActiveSnapshot();
    }

    function initializeRoundSnapshots() {
        if (Array.isArray(simulationData.round_snapshots) && simulationData.round_snapshots.length > 0) {
            roundSnapshots = simulationData.round_snapshots
                .map(normalizeRoundSnapshot)
                .filter(snapshot => snapshot && Array.isArray(snapshot.results))
                .sort((a, b) => {
                    if (a.round_order !== b.round_order) {
                        return a.round_order - b.round_order;
                    }
                    return a.round_label.localeCompare(b.round_label);
                });
        } else {
            roundSnapshots = [
                normalizeRoundSnapshot({
                    round_key: simulationData.current_round_key || 'latest',
                    round_label: simulationData.current_round_label || 'Current Snapshot',
                    round_tab_label: simulationData.current_round_tab_label || 'Current',
                    round_order: 9999,
                    round_number: simulationData.current_round_number || null,
                    num_simulations: simulationData.num_simulations,
                    completed_matches: simulationData.completed_matches,
                    remaining_matches: simulationData.remaining_matches,
                    last_updated: simulationData.last_updated,
                    results: simulationData.results || []
                })
            ];
        }

        const defaultRoundKey = getDefaultRoundSnapshotKey();
        activeSnapshot = roundSnapshots.find(snapshot => snapshot.round_key === defaultRoundKey) ||
            roundSnapshots[roundSnapshots.length - 1] ||
            null;
    }

    function normalizeRoundSnapshot(snapshot) {
        if (!snapshot) {
            return null;
        }

        const completedMatches = Number.isFinite(Number(snapshot.completed_matches))
            ? Number(snapshot.completed_matches)
            : 0;
        const remainingMatches = Number.isFinite(Number(snapshot.remaining_matches))
            ? Number(snapshot.remaining_matches)
            : 0;
        const numSimulations = Number.isFinite(Number(snapshot.num_simulations))
            ? Number(snapshot.num_simulations)
            : 0;
        const roundOrder = Number.isFinite(Number(snapshot.round_order))
            ? Number(snapshot.round_order)
            : 9999;

        return {
            round_key: String(snapshot.round_key || 'round-unknown'),
            round_label: String(snapshot.round_label || 'Current Snapshot'),
            round_tab_label: String(snapshot.round_tab_label || snapshot.round_label || 'Current'),
            round_order: roundOrder,
            round_number: snapshot.round_number || null,
            completed_matches: completedMatches,
            remaining_matches: remainingMatches,
            num_simulations: numSimulations,
            last_updated: snapshot.last_updated || simulationData.last_updated || null,
            results: Array.isArray(snapshot.results) ? snapshot.results : []
        };
    }

    function getDefaultRoundSnapshotKey() {
        if (simulationData.current_round_key) {
            return String(simulationData.current_round_key);
        }

        if (roundSnapshots.length > 0) {
            return roundSnapshots[roundSnapshots.length - 1].round_key;
        }

        return null;
    }

    function renderRoundTabs() {
        if (!roundSnapshotNav || !roundTabsContainer) {
            return;
        }

        roundTabsContainer.innerHTML = '';

        if (roundSnapshots.length <= 1) {
            roundSnapshotNav.style.display = 'none';
            if (roundSnapshotContext && activeSnapshot) {
                roundSnapshotContext.textContent = activeSnapshot.round_label;
            }
            return;
        }

        roundSnapshotNav.style.display = 'block';

        roundSnapshots.forEach(snapshot => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'round-tab-button';
            button.textContent = snapshot.round_tab_label;
            button.dataset.roundKey = snapshot.round_key;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', snapshot.round_key === activeSnapshot?.round_key ? 'true' : 'false');
            button.title = snapshot.round_label;

            if (snapshot.round_key === activeSnapshot?.round_key) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => handleRoundTabChange(snapshot.round_key));
            roundTabsContainer.appendChild(button);
        });
    }

    function handleRoundTabChange(roundKey) {
        const nextSnapshot = roundSnapshots.find(snapshot => snapshot.round_key === roundKey);
        if (!nextSnapshot || nextSnapshot.round_key === activeSnapshot?.round_key) {
            return;
        }

        activeSnapshot = nextSnapshot;
        renderRoundTabs();
        displayActiveSnapshot();
    }

    function displayActiveSnapshot() {
        if (!activeSnapshot) {
            return;
        }

        if (roundSnapshotContext) {
            roundSnapshotContext.textContent = activeSnapshot.round_label;
        }

        document.getElementById('num-simulations').textContent =
            activeSnapshot.num_simulations.toLocaleString();
        document.getElementById('completed-matches').textContent =
            activeSnapshot.completed_matches;
        document.getElementById('completed-subtext').textContent =
            `${activeSnapshot.round_label} • ${activeSnapshot.completed_matches} matches played`;
        document.getElementById('remaining-matches').textContent =
            activeSnapshot.remaining_matches;
        document.getElementById('last-updated').textContent =
            formatRelativeTime(activeSnapshot.last_updated);

        summaryStats.style.display = 'grid';
        tableContainer.style.display = 'block';

        populateTable();
        populateLadderPositionMatrix();
    }

    function formatRelativeTime(isoDate) {
        if (!isoDate) {
            return '-';
        }

        const timestamp = new Date(isoDate);
        if (Number.isNaN(timestamp.getTime())) {
            return '-';
        }

        const now = new Date();
        const diffMs = now - timestamp;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) {
            return diffMins <= 0 ? 'Just now' : `${diffMins}m ago`;
        }
        if (diffHours < 24) {
            return `${diffHours}h ago`;
        }
        return `${diffDays}d ago`;
    }

    /**
     * Populate the simulation results table
     */
    function populateTable() {
        tbody.innerHTML = '';

        if (!activeSnapshot || !Array.isArray(activeSnapshot.results)) {
            return;
        }

        // Sort the data
        const sortedResults = sortResults(activeSnapshot.results);

        // Create table rows
        sortedResults.forEach((team, index) => {
            const row = document.createElement('tr');

            // Position
            const position = index + 1;
            const posClass = position <= 8 ? 'top8' : '';

            // Record
            let record = `${team.current_wins}-${team.current_losses}`;
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
     * Determine the background and text color for probability cells
     */
    function buildCellStyle(probability, blendConfig) {
        const clamped = Math.max(0, Math.min(probability, 1));
        const mixFactor = blendConfig.min + (blendConfig.max - blendConfig.min) * Math.pow(clamped, blendConfig.power);
        const baseColor = getProbabilityColor(clamped);
        const blended = interpolateColor(WHITE_COLOR, baseColor, mixFactor);
        const textColor = getContrastTextColor(blended);

        return {
            background: `rgb(${blended[0]}, ${blended[1]}, ${blended[2]})`,
            textColor,
            intensity: clamped
        };
    }

    /**
     * Create a probability cell with full-cell heatmap styling
     */
    function createProbabilityCell(probability) {
        const percentage = (probability * 100).toFixed(1);
        const displayValue = probability < 0.01 && probability > 0 ? '<1%' : `${percentage}%`;
        const { background, textColor } = buildCellStyle(probability, TABLE_COLOR_BLEND);

        return `
            <td class="prob-cell" style="background-color: ${background}; color: ${textColor};">
                <span class="prob-value">${displayValue}</span>
            </td>
        `;
    }

    /**
     * Style ladder matrix cells using the probability colour scale
     */
    function applyMatrixCellStyling(cell, probability) {
        const { background, textColor, intensity } = buildCellStyle(probability, MATRIX_COLOR_BLEND);

        cell.style.backgroundColor = background;
        cell.style.color = textColor;

        if (intensity >= 0.75) {
            cell.style.fontWeight = '700';
        } else if (intensity >= 0.4) {
            cell.style.fontWeight = '600';
        } else {
            cell.style.fontWeight = '500';
        }
    }

    /**
     * Populate the ladder position probability matrix
     */
    function populateLadderPositionMatrix() {
        // Check if ladder position data is available
        if (!activeSnapshot || !activeSnapshot.results || !activeSnapshot.results[0] ||
            !activeSnapshot.results[0].ladder_position_probabilities) {
            // Hide the ladder position card if data is not available
            ladderPositionCard.style.display = 'none';
            return;
        }

        // Show the ladder position card
        ladderPositionCard.style.display = 'block';

        // Get the number of teams
        const numTeams = activeSnapshot.results.length;

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
        const sortedTeams = [...activeSnapshot.results].sort((a, b) =>
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
                const probability = team.ladder_position_probabilities?.[String(pos)] || 0;

                if (probability <= 0) {
                    cell.className = 'prob-zero';
                    cell.textContent = '-';
                    row.appendChild(cell);
                    continue;
                }

                const percentage = (probability * 100).toFixed(0);
                cell.textContent = probability < 0.01 ? '<1' : percentage;
                applyMatrixCellStyling(cell, probability);
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
        if (roundSnapshotNav) {
            roundSnapshotNav.style.display = 'none';
        }
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
        if (roundSnapshotNav) {
            roundSnapshotNav.style.display = 'none';
        }
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
