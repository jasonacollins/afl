const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { logger } = require('../utils/logger');
const { getQuery } = require('../models/db');

const MIN_CHART_YEAR = 2000;
const WILDCARD_FINALS_START_YEAR = 2026;
const FINALS_WEEK_2_LABEL = 'Finals Week 2';
const LEGACY_FINALS_WEEK_1_LABEL = 'Finals Week 1';
const FINALS_WEEK_1_ROUNDS = new Set(['Elimination Final', 'Qualifying Final']);
const FINALS_ORDER = {
  'Wildcard Finals': 99,
  'Wildcard Round': 99, // Backward compatibility
  'Elimination Final': 100,
  'Qualifying Final': 100,
  'Semi Final': 101,
  'Preliminary Final': 102,
  'Grand Final': 103
};

function isFinalsWeek1Round(round) {
  return FINALS_WEEK_1_ROUNDS.has(round);
}

function getFinalsWeekDisplayLabel(year) {
  const parsedYear = parseInt(year, 10);
  if (!Number.isNaN(parsedYear) && parsedYear >= WILDCARD_FINALS_START_YEAR) {
    return FINALS_WEEK_2_LABEL;
  }

  return LEGACY_FINALS_WEEK_1_LABEL;
}

/**
 * Service for processing and serving ELO rating data
 */
class EloService {
  /**
   * Get team colors from database
   * @param {Array} teams - Array of team names
   * @returns {Promise<Object>} Object mapping team names to hex colors
   */
  async getTeamColors(teams) {
    try {
      if (!teams || teams.length === 0) {
        return {};
      }
      
      const placeholders = teams.map(() => '?').join(',');
      const colors = await getQuery(
        `SELECT name, colour_hex FROM teams WHERE name IN (${placeholders})`,
        teams
      );
      
      const colorMap = {};
      colors.forEach(row => {
        if (row.colour_hex) {
          colorMap[row.name] = `#${row.colour_hex}`;
        }
      });
      
      logger.info(`Loaded team colors for ${Object.keys(colorMap).length} teams`);
      return colorMap;
    } catch (error) {
      logger.error('Error loading team colors from database', { error: error.message });
      return {};
    }
  }

  /**
   * Get ELO ratings data for a specific year
   * @param {number} year - The year to get ratings for
   * @returns {Promise<Object>} Processed ELO data with teams and ratings over time
   */
  async getEloRatingsForYear(year) {
    try {
      const csvPath = this.getEloDataPath();
      
      logger.info(`ELO data path resolved for year ${year}`, { 
        csvPath,
        exists: fs.existsSync(csvPath)
      });
      
      if (!fs.existsSync(csvPath)) {
        logger.warn(`ELO data file not found for year ${year}`, { path: csvPath });
        return { teams: [], data: [], year, error: `No ELO data available for ${year}` };
      }

      const rawData = await this.readEloCSV(csvPath);
      logger.info(`Raw CSV data loaded for year ${year}`, {
        csvPath,
        rawDataLength: rawData.length
      });
      
      const processedData = this.processEloData(rawData, year);
      
      // Add team colors to the response
      const teamColors = await this.getTeamColors(processedData.teams);
      processedData.teamColors = teamColors;
      
      logger.info(`Successfully processed ELO data for year ${year}`, { 
        teamsCount: processedData.teams.length,
        dataPoints: processedData.data.length,
        teamColorsCount: Object.keys(teamColors).length
      });
      
      return processedData;
    } catch (error) {
      logger.error(`Error getting ELO ratings for year ${year}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Get ELO ratings data for a year range using the complete historical CSV file
   * @param {number} startYear - Start year
   * @param {number} endYear - End year  
   * @returns {Promise<Object>} Processed ELO data with teams and ratings over time
   */
  async getEloRatingsForYearRange(startYear, endYear) {
    try {
      logger.info(`Getting ELO data for year range ${startYear} to ${endYear}`, { 
        startYear, 
        endYear 
      });

      // Use the single complete historical CSV file
      const csvPath = this.getEloDataPath();
      
      if (!fs.existsSync(csvPath)) {
        return { 
          teams: [], 
          data: [], 
          startYear, 
          endYear,
          error: `No ELO data available for year range ${startYear} to ${endYear}` 
        };
      }

      const rawData = await this.readEloCSV(csvPath);
      logger.info(`Loaded complete CSV data for year range`, {
        csvPath,
        totalRecords: rawData.length
      });
      
      const processedData = this.processEloDataForYearRange(rawData, startYear, endYear);
      
      // Add team colors to the response
      const teamColors = await this.getTeamColors(processedData.teams);
      processedData.teamColors = teamColors;
      
      logger.info(`Successfully processed ELO data for year range`, {
        startYear,
        endYear,
        teamsCount: processedData.teams.length,
        dataPoints: processedData.data.length,
        teamColorsCount: Object.keys(teamColors).length
      });
      
      return processedData;
    } catch (error) {
      logger.error(`Error getting ELO ratings for year range ${startYear} to ${endYear}`, { error: error.message });
      throw error;
    }
  }


  /**
   * Get the path to the complete ELO data CSV file
   * @returns {string} Path to the complete CSV file
   */
  getEloDataPath() {
    // Use single complete historical CSV file
    return path.join(__dirname, '../data/historical/afl_elo_complete_history.csv');
  }

  /**
   * Read and parse ELO CSV data
   * @param {string} csvPath - Path to the CSV file
   * @returns {Promise<Array>} Parsed CSV data
   */
  async readEloCSV(csvPath) {
    return new Promise((resolve, reject) => {
      const results = [];
      
      fs.createReadStream(csvPath)
        .pipe(parse({ 
          header: true,
          skip_empty_lines: true,
          columns: true
        }))
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  /**
   * Process raw ELO data for year range into step-pattern chart format
   * @param {Array} rawData - Raw CSV data
   * @param {number} startYear - Start year
   * @param {number} endYear - End year
   * @returns {Object} Processed data with teams and step-pattern rating progression
   */
  processEloDataForYearRange(rawData, startYear, endYear) {
    // Filter for the year range (no event column anymore)
    const filteredData = rawData.filter(row => {
      if (!row.year) return false;
      
      const year = parseInt(row.year);
      return year >= startYear && year <= endYear;
    });

    if (filteredData.length === 0) {
      return { 
        teams: [], 
        data: [], 
        startYear, 
        endYear, 
        error: `No match data found for year range ${startYear} to ${endYear}` 
      };
    }

    // Sort by date to ensure chronological order
    filteredData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get unique teams
    const teams = [...new Set(filteredData.map(row => row.team))].sort();
    
    logger.info(`Processing step-pattern ELO data for year range ${startYear}-${endYear}: ${teams.length} teams, ${filteredData.length} match records`);
    
    // Group matches by year and round for vertical alignment
    const matchesByYearRound = new Map();
    filteredData.forEach(row => {
      const groupKey = `${row.year}-${row.round}`;
      if (!matchesByYearRound.has(groupKey)) {
        matchesByYearRound.set(groupKey, []);
      }
      matchesByYearRound.get(groupKey).push(row);
    });

    // Sort groups chronologically with season gaps
    const sortedYearRounds = Array.from(matchesByYearRound.keys()).sort((a, b) => {
      const [yearA, roundA] = a.split('-', 2);
      const [yearB, roundB] = b.split('-', 2);
      
      // First sort by year
      const yearCompare = parseInt(yearA) - parseInt(yearB);
      if (yearCompare !== 0) return yearCompare;
      
      // Then by round within the same year
      return this.compareRounds(roundA, roundB);
    });
    
    // Track each team's rating throughout the period
    const teamRatings = {};
    const chartData = [];
    
    // Initialize with first known ratings for each team
    teams.forEach(team => {
      const firstMatch = filteredData.find(row => row.team === team);
      if (firstMatch) {
        teamRatings[team] = parseFloat(firstMatch.rating_before);
      } else {
        teamRatings[team] = 1500; // Default rating
      }
    });

    let previousYear = null;
    let stepIndex = 0;
    
    // Count total rounds per year for proper spacing
    const roundsPerYear = new Map();
    sortedYearRounds.forEach(yearRoundKey => {
      const [year] = yearRoundKey.split('-', 2);
      const currentYear = parseInt(year);
      roundsPerYear.set(currentYear, (roundsPerYear.get(currentYear) || 0) + 1);
    });
    
    const yearPositions = new Map(); // Track position within each year

    // Create a mapping to track Finals Week 1 across years
    const yearRoundToXCoord = new Map();
    const finalsWeek1Tracking = new Map(); // Track if we've seen Finals Week 1 for each year

    // Pre-calculate x-coordinates for all year-rounds
    sortedYearRounds.forEach((yearRoundKey) => {
      const [year, round] = yearRoundKey.split('-', 2);
      const currentYear = parseInt(year);
      const isFinalsWeek1 = isFinalsWeek1Round(round);

      // Check for season change
      if (previousYear !== null && currentYear !== previousYear) {
        // Add gap between years
        stepIndex += 2;
        finalsWeek1Tracking.delete(previousYear); // Clear tracking for previous year
      }

      if (isFinalsWeek1) {
        const alreadySeenFinalsWeek1 = finalsWeek1Tracking.has(currentYear);
        if (!alreadySeenFinalsWeek1) {
          // First Finals Week 1 round for this year
          yearRoundToXCoord.set(yearRoundKey, stepIndex);
          finalsWeek1Tracking.set(currentYear, stepIndex);
          stepIndex++; // Increment only once for Finals Week 1
        } else {
          // Second Finals Week 1 round - use same coordinate
          yearRoundToXCoord.set(yearRoundKey, finalsWeek1Tracking.get(currentYear));
        }
      } else {
        // Not Finals Week 1 - use sequential index
        yearRoundToXCoord.set(yearRoundKey, stepIndex);
        stepIndex++;
      }

      previousYear = currentYear;
    });

    // Reset for actual processing
    previousYear = null;

    sortedYearRounds.forEach(yearRoundKey => {
      const [year, round] = yearRoundKey.split('-', 2);
      const currentYear = parseInt(year);
      const roundMatches = matchesByYearRound.get(yearRoundKey);
      const roundXCoordinate = yearRoundToXCoord.get(yearRoundKey);

      // Initialize year position tracking
      if (!yearPositions.has(currentYear)) {
        yearPositions.set(currentYear, 0);
      }

      // Check for season change and update team ratings
      if (previousYear !== null && currentYear !== previousYear) {
        // Update team ratings to reflect season carryover for ALL teams in the new year
        teams.forEach(team => {
          // Find the first match for this team in the current year (any round)
          const firstMatchInYear = filteredData.find(match =>
            match.team === team && parseInt(match.year) === currentYear
          );
          if (firstMatchInYear) {
            teamRatings[team] = parseFloat(firstMatchInYear.rating_before);
          }
        });
      }

      // Get teams that actually play in this round
      const teamsInThisRound = new Set(roundMatches.map(match => match.team));

      yearPositions.set(currentYear, yearPositions.get(currentYear) + 1);

      // Determine display label for round
      const isFinalsWeek1 = isFinalsWeek1Round(round);
      const roundLabel = isFinalsWeek1 ? getFinalsWeekDisplayLabel(currentYear) : round;

      // Create "before" data point - only for teams that play in this round
      const beforePoint = {
        x: roundXCoordinate,
        year: currentYear,
        round: roundLabel,
        type: 'before',
        label: `${year} ${roundLabel} (Start)`
      };
      
      // Only add ratings for teams that actually play in this round
      // Use the actual rating_before from the CSV data, not the tracking variable
      teamsInThisRound.forEach(team => {
        const teamMatch = roundMatches.find(match => match.team === team);
        if (teamMatch) {
          beforePoint[team] = parseFloat(teamMatch.rating_before);
          // Add match details for hover tooltip
          beforePoint[`${team}_match`] = {
            opponent: teamMatch.opponent,
            score: teamMatch.score,
            opponent_score: teamMatch.opponent_score,
            result: teamMatch.result
          };
        }
      });
      chartData.push(beforePoint);

      // Sort matches within round by date, then by team for consistent ordering
      roundMatches.sort((a, b) => {
        const dateCompare = new Date(a.date) - new Date(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.team.localeCompare(b.team);
      });

      // Group matches by individual games within this round
      const gameGroups = new Map();
      roundMatches.forEach(match => {
        const gameKey = `${match.date}-${match.match_id}`;
        if (!gameGroups.has(gameKey)) {
          gameGroups.set(gameKey, []);
        }
        gameGroups.get(gameKey).push(match);
      });

      // Sort games by date within the round
      const sortedGames = Array.from(gameGroups.entries()).sort((a, b) => {
        const [dateA] = a[0].split('-', 1);
        const [dateB] = b[0].split('-', 1);
        return new Date(dateA) - new Date(dateB);
      });

      // Process each individual game within this round - all use same x-coordinate
      sortedGames.forEach(([gameKey, gameMatches], gameIndex) => {
        // Use the same x-coordinate that was set for the "before" point
        
        // Process all teams in this game and update their ratings
        gameMatches.forEach(match => {
          const team = match.team;
          const ratingAfter = parseFloat(match.rating_after);
          if (!isNaN(ratingAfter)) {
            teamRatings[team] = ratingAfter;
          }
        });

        // Create data point after this game - same x-coordinate for perfect alignment
        const afterGamePoint = {
          x: roundXCoordinate, // Same x-coordinate for all games in this round
          year: currentYear,
          round: roundLabel,
          type: 'after_game',
          label: `${year} ${roundLabel} (Game ${gameIndex + 1})`,
          gameIndex: gameIndex
        };
        
        // Only add ratings for teams that actually play in this round
        // Use the actual rating_after from the CSV data, not the tracking variable
        teamsInThisRound.forEach(team => {
          const teamMatch = gameMatches.find(match => match.team === team);
          if (teamMatch) {
            afterGamePoint[team] = parseFloat(teamMatch.rating_after);
            // Add match details for hover tooltip
            afterGamePoint[`${team}_match`] = {
              opponent: teamMatch.opponent,
              score: teamMatch.score,
              opponent_score: teamMatch.opponent_score,
              result: teamMatch.result
            };
          }
        });
        chartData.push(afterGamePoint);
      });
      
      previousYear = currentYear;
    });

    // Create year label mapping for x-axis based on actual x-coordinates
    const yearLabels = new Map();
    const yearRanges = new Map();
    
    // Track the x-coordinate ranges for each year
    chartData.forEach(point => {
      const year = point.year;
      const x = point.x;
      
      if (!yearRanges.has(year)) {
        yearRanges.set(year, { min: x, max: x });
      } else {
        const range = yearRanges.get(year);
        range.min = Math.min(range.min, x);
        range.max = Math.max(range.max, x);
      }
    });
    
    // Calculate center positions for year labels
    yearRanges.forEach((range, year) => {
      const center = (range.min + range.max) / 2;
      yearLabels.set(center, year);
    });

    logger.info(`Generated step-pattern ELO data for year range: ${chartData.length} data points`);
    logger.info(`Year labels created:`, Array.from(yearLabels.entries()));

    return {
      teams,
      data: chartData,
      startYear,
      endYear,
      yearRange: `${startYear} to ${endYear}`,
      yearLabels: Array.from(yearLabels.entries()), // [[position, year], ...]
      isStepPattern: true,
      totalMatches: filteredData.length / 2, // Divide by 2 since each match has 2 entries
      totalSteps: chartData.length
    };
  }

  /**
   * Compare two round strings for sorting
   * @param {string} roundA - First round
   * @param {string} roundB - Second round
   * @returns {number} Comparison result
   */
  compareRounds(roundA, roundB) {
    // Handle opening round first
    if (roundA === 'OR' && roundB !== 'OR') return -1;
    if (roundB === 'OR' && roundA !== 'OR') return 1;
    if (roundA === 'OR' && roundB === 'OR') return 0;

    // Handle finals
    if (FINALS_ORDER[roundA] !== undefined && FINALS_ORDER[roundB] !== undefined) {
      return FINALS_ORDER[roundA] - FINALS_ORDER[roundB];
    }
    if (FINALS_ORDER[roundA] !== undefined) return 1;
    if (FINALS_ORDER[roundB] !== undefined) return -1;

    // Handle regular season rounds (numbers)
    const numA = parseInt(roundA);
    const numB = parseInt(roundB);

    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }

    // Fallback to string comparison
    return roundA.localeCompare(roundB);
  }

  /**
   * Process raw ELO data into step-pattern chart format
   * @param {Array} rawData - Raw CSV data
   * @param {number} year - The year being processed
   * @returns {Object} Processed data with teams and step-pattern rating progression
   */
  processEloData(rawData, year) {
    // Filter for the specific year (no event column anymore)
    const yearData = rawData.filter(row => 
      row.year == year
    );

    if (yearData.length === 0) {
      return { teams: [], data: [], year, error: `No match data found for ${year}` };
    }

    // Sort by date to ensure chronological order within rounds
    yearData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get unique teams
    const teams = [...new Set(yearData.map(row => row.team))].sort();
    
    logger.info(`Processing step-pattern ELO data for ${year}: ${teams.length} teams, ${yearData.length} match records`);
    
    // Create step-pattern data structure - before and after points for each match
    const chartData = [];
    
    // Track each team's current rating
    const teamRatings = {};
    
    // Initialize with first known ratings for each team
    teams.forEach(team => {
      const firstMatch = yearData.find(row => row.team === team);
      if (firstMatch) {
        teamRatings[team] = parseFloat(firstMatch.rating_before);
      } else {
        teamRatings[team] = 1500; // Default ELO rating
      }
    });

    // Group matches by round only (ignore date for vertical alignment)
    const matchesByRound = new Map();
    yearData.forEach(match => {
      const round = match.round;
      if (!matchesByRound.has(round)) {
        matchesByRound.set(round, []);
      }
      matchesByRound.get(round).push(match);
    });

    // Sort rounds properly
    const sortedRounds = Array.from(matchesByRound.keys()).sort((a, b) => {
      return this.compareRounds(a, b);
    });

    // Create a mapping of rounds to their x-coordinate index
    // Rounds that should appear together (Finals Week 1) get the same index
    const roundToXCoord = new Map();
    let xCoordIndex = 0;
    let previousFinalsWeek1 = false;

    sortedRounds.forEach((round) => {
      const isFinalsWeek1 = isFinalsWeek1Round(round);

      if (isFinalsWeek1) {
        if (!previousFinalsWeek1) {
          // First Finals Week 1 round - use current index
          roundToXCoord.set(round, xCoordIndex);
          previousFinalsWeek1 = true;
        } else {
          // Second Finals Week 1 round - use same index as first
          roundToXCoord.set(round, xCoordIndex);
        }
      } else {
        // Not Finals Week 1 - increment if we just finished Finals Week 1
        if (previousFinalsWeek1) {
          xCoordIndex++;
          previousFinalsWeek1 = false;
        }
        roundToXCoord.set(round, xCoordIndex);
      }

      // Increment for next round (unless it's the second Finals Week 1 round)
      if (!isFinalsWeek1 || !previousFinalsWeek1) {
        xCoordIndex++;
      }
    });

    sortedRounds.forEach((round) => {
      const roundMatches = matchesByRound.get(round);
      const roundXCoord = roundToXCoord.get(round);

      // Sort matches within round by date, then by team to ensure consistent ordering
      roundMatches.sort((a, b) => {
        const dateCompare = new Date(a.date) - new Date(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.team.localeCompare(b.team);
      });

      // Group matches by individual games (same date, paired teams)
      const gameGroups = new Map();
      roundMatches.forEach(match => {
        const gameKey = `${match.date}-${match.match_id}`;
        if (!gameGroups.has(gameKey)) {
          gameGroups.set(gameKey, []);
        }
        gameGroups.get(gameKey).push(match);
      });

      // Sort games by date within the round
      const sortedGames = Array.from(gameGroups.entries()).sort((a, b) => {
        const [dateA] = a[0].split('-', 1);
        const [dateB] = b[0].split('-', 1);
        return new Date(dateA) - new Date(dateB);
      });

      // Get teams that actually play in this round
      const teamsInThisRound = new Set(roundMatches.map(match => match.team));

      // Determine display label for round
      const isFinalsWeek1 = isFinalsWeek1Round(round);
      const roundLabel = isFinalsWeek1 ? getFinalsWeekDisplayLabel(year) : round;

      // Create "before" data point - only for teams that play in this round
      const beforePoint = {
        x: roundXCoord,
        round: roundLabel,
        type: 'before',
        label: `${roundLabel} (Start)`
      };
      
      // Only add ratings for teams that actually play in this round
      // Use the actual rating_before from the CSV data, not the tracking variable
      teamsInThisRound.forEach(team => {
        const teamMatch = roundMatches.find(match => match.team === team);
        if (teamMatch) {
          beforePoint[team] = parseFloat(teamMatch.rating_before);
          // Add match details for hover tooltip
          beforePoint[`${team}_match`] = {
            opponent: teamMatch.opponent,
            score: teamMatch.score,
            opponent_score: teamMatch.opponent_score,
            result: teamMatch.result
          };
        }
      });
      chartData.push(beforePoint);

      // Process each individual game within this round - all use EXACT same x-coordinate
      sortedGames.forEach(([gameKey, gameMatches], gameIndex) => {
        // Process all teams in this game and update their ratings
        gameMatches.forEach(match => {
          const team = match.team;
          const ratingAfter = parseFloat(match.rating_after);
          if (!isNaN(ratingAfter)) {
            teamRatings[team] = ratingAfter;
          }
        });

        // Create data point after this game - EXACT same x-coordinate for perfect alignment
        const afterGamePoint = {
          x: roundXCoord, // Exact same x-coordinate as round for perfect vertical alignment
          round: roundLabel,
          type: 'after_game',
          label: `${roundLabel} (Game ${gameIndex + 1})`,
          gameIndex: gameIndex
        };
        
        // Only add ratings for teams that actually play in this round
        // Use the actual rating_after from the CSV data, not the tracking variable
        teamsInThisRound.forEach(team => {
          const teamMatch = gameMatches.find(match => match.team === team);
          if (teamMatch) {
            afterGamePoint[team] = parseFloat(teamMatch.rating_after);
            // Add match details for hover tooltip
            afterGamePoint[`${team}_match`] = {
              opponent: teamMatch.opponent,
              score: teamMatch.score,
              opponent_score: teamMatch.opponent_score,
              result: teamMatch.result
            };
          }
        });
        chartData.push(afterGamePoint);
      });
    });

    logger.info(`Generated step-pattern ELO data: ${chartData.length} data points for ${year}`);

    return {
      teams,
      data: chartData,
      year,
      isStepPattern: true,
      totalMatches: yearData.length / 2, // Divide by 2 since each match has 2 entries
      totalSteps: chartData.length
    };
  }

  /**
   * Get the next round after a given round
   * @param {string} currentRound - Current round
   * @returns {string} Next round
   */
  getNextRound(currentRound) {
    // Handle numeric rounds
    const roundNum = parseInt(currentRound);
    if (!isNaN(roundNum)) {
      return (roundNum + 1).toString();
    }
    
    // Handle special cases
    switch (currentRound) {
      case 'OR':
        return '1';
      case 'Wildcard Finals':
      case 'Wildcard Round':
        return 'Elimination Final';
      case 'Elimination Final':
        return 'Qualifying Final';
      case 'Qualifying Final':
        return 'Semi Final';
      case 'Semi Final':
        return 'Preliminary Final';
      case 'Preliminary Final':
        return 'Grand Final';
      case 'Grand Final':
        return 'Season Complete';
      default:
        return 'Next Round';
    }
  }

  /**
   * Sort AFL rounds in proper order
   * @param {Array} rounds - Array of round names/numbers
   * @returns {Array} Sorted rounds
   */
  sortRounds(rounds) {
    return rounds.sort((a, b) => {
      // Handle pre-season/opening round
      if (a === 'OR') return -1;
      if (b === 'OR') return 1;

      // Handle finals
      if (FINALS_ORDER[a] !== undefined && FINALS_ORDER[b] !== undefined) {
        return FINALS_ORDER[a] - FINALS_ORDER[b];
      }
      if (FINALS_ORDER[a] !== undefined) return 1;
      if (FINALS_ORDER[b] !== undefined) return -1;

      // Handle regular season rounds (numbers)
      const numA = parseInt(a);
      const numB = parseInt(b);

      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }

      // Fallback to string comparison
      return a.localeCompare(b);
    });
  }

  /**
   * Get available years for ELO data by reading the complete CSV file
   * @returns {Array<number>} Array of available years
   */
  async getAvailableYears() {
    try {
      const csvPath = this.getEloDataPath();
      
      if (!fs.existsSync(csvPath)) {
        return [];
      }
      
      const rawData = await this.readEloCSV(csvPath);
      const years = new Set();
      
      rawData.forEach(row => {
        if (row.year) {
          const parsedYear = parseInt(row.year, 10);
          if (Number.isFinite(parsedYear) && parsedYear >= MIN_CHART_YEAR) {
            years.add(parsedYear);
          }
        }
      });
      
      return Array.from(years).sort((a, b) => b - a); // Sort descending (newest first)
    } catch (error) {
      logger.error('Error getting available years', { error: error.message });
      return [];
    }
  }
}

module.exports = new EloService();
