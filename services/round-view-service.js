const roundService = require('./round-service');
const { logger } = require('../utils/logger');

function groupMatchesByRound(matches) {
  return matches.reduce((grouped, match) => {
    if (!grouped[match.round_number]) {
      grouped[match.round_number] = [];
    }
    grouped[match.round_number].push(match);
    return grouped;
  }, {});
}

function addRoundCompletionStatus(rounds, matches) {
  const matchesByRound = groupMatchesByRound(matches);

  return rounds.map((roundObj) => {
    const roundMatches = matchesByRound[roundObj.round_number] || [];
    const isCompleted = roundMatches.length > 0
      && roundMatches.every((match) => match.hscore !== null && match.ascore !== null);

    return {
      ...roundObj,
      isCompleted
    };
  });
}

function buildDisplayRounds(rounds, matches, year) {
  return roundService.combineRoundsForDisplay(
    addRoundCompletionStatus(rounds, matches),
    year
  );
}

function getCurrentRound(displayRounds) {
  const currentRoundObj = displayRounds.find((round) => !round.isCompleted);
  return currentRoundObj ? currentRoundObj.round_number : null;
}

function parseMatchDate(match, context) {
  if (!match.match_date) {
    return null;
  }

  const matchDate = new Date(match.match_date);
  if (Number.isNaN(matchDate.getTime())) {
    logger.error('Error parsing match date', {
      matchDate: match.match_date,
      context,
      error: 'Invalid date'
    });
    return null;
  }

  return matchDate;
}

function findNextUpcomingMatch(matches, now = new Date()) {
  let nextUpcomingMatch = null;

  for (const match of matches) {
    const matchDate = parseMatchDate(match, 'default-round-upcoming');
    if (!matchDate) {
      continue;
    }

    const isUnplayed = match.hscore === null || match.ascore === null;
    if (!isUnplayed || matchDate <= now) {
      continue;
    }

    if (!nextUpcomingMatch || matchDate < new Date(nextUpcomingMatch.match_date)) {
      nextUpcomingMatch = match;
    }
  }

  return nextUpcomingMatch;
}

function findMostRecentCompletedMatch(matches) {
  let mostRecentCompletedMatch = null;

  for (const match of matches) {
    if (match.hscore === null || match.ascore === null) {
      continue;
    }

    const matchDate = parseMatchDate(match, 'default-round-completed');
    if (!matchDate) {
      continue;
    }

    if (!mostRecentCompletedMatch || matchDate > new Date(mostRecentCompletedMatch.match_date)) {
      mostRecentCompletedMatch = match;
    }
  }

  return mostRecentCompletedMatch;
}

function isSameLocalDate(leftDate, rightDate) {
  return leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate();
}

function normalizeMatchRound(match, year) {
  return roundService.normalizeRoundForDisplay(match.round_number, year);
}

function selectDefaultRound(matches, rounds, year, options = {}) {
  const {
    now = new Date(),
    fallbackRound = null,
    preferTodayCompletedRound = false
  } = options;

  const mostRecentCompletedMatch = findMostRecentCompletedMatch(matches);
  if (preferTodayCompletedRound && mostRecentCompletedMatch) {
    const completedMatchDate = parseMatchDate(mostRecentCompletedMatch, 'default-round-recent-completed');
    if (completedMatchDate && isSameLocalDate(completedMatchDate, now)) {
      return normalizeMatchRound(mostRecentCompletedMatch, year);
    }
  }

  const nextUpcomingMatch = findNextUpcomingMatch(matches, now);
  if (nextUpcomingMatch) {
    return normalizeMatchRound(nextUpcomingMatch, year);
  }

  if (mostRecentCompletedMatch) {
    return normalizeMatchRound(mostRecentCompletedMatch, year);
  }

  if (Array.isArray(rounds) && rounds.length > 0) {
    const firstRound = roundService.normalizeRoundForDisplay(rounds[0].round_number, year);
    if (firstRound) {
      return firstRound;
    }
  }

  return fallbackRound;
}

module.exports = {
  addRoundCompletionStatus,
  buildDisplayRounds,
  findMostRecentCompletedMatch,
  findNextUpcomingMatch,
  getCurrentRound,
  groupMatchesByRound,
  selectDefaultRound
};
