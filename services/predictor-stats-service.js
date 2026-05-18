const scoringService = require('./scoring-service');

function getActualOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) {
    return 1;
  }
  if (homeScore === awayScore) {
    return 0.5;
  }
  return 0;
}

function getTipSide(prediction) {
  if (prediction.tipped_team) {
    return prediction.tipped_team;
  }
  return prediction.home_win_probability < 50 ? 'away' : 'home';
}

function calculatePredictionMetrics(prediction) {
  const actualOutcome = getActualOutcome(prediction.hscore, prediction.ascore);
  const tippedTeam = getTipSide(prediction);
  const tipPoints = scoringService.calculateTipPoints(
    prediction.home_win_probability,
    prediction.hscore,
    prediction.ascore,
    tippedTeam
  );
  const brierScore = scoringService.calculateBrierScore(
    prediction.home_win_probability,
    actualOutcome
  );
  const bitsScore = scoringService.calculateBitsScore(
    prediction.home_win_probability,
    actualOutcome
  );

  let marginError = null;
  if (prediction.predicted_margin !== null && prediction.predicted_margin !== undefined) {
    marginError = Math.abs((prediction.hscore - prediction.ascore) - prediction.predicted_margin);
  }

  return {
    actualOutcome,
    tippedTeam,
    tipPoints,
    brierScore,
    bitsScore,
    marginError
  };
}

function calculatePredictorStats(predictor, predictionResults, options = {}) {
  const {
    bitsScoreDigits = 4,
    emptyValue = 0
  } = options;

  let tipPoints = 0;
  let totalBrierScore = 0;
  let totalBitsScore = 0;
  let marginErrorSum = 0;
  let marginPredictionCount = 0;
  const totalPredictions = predictionResults.length;

  predictionResults.forEach((prediction) => {
    const metrics = calculatePredictionMetrics(prediction);
    tipPoints += metrics.tipPoints;
    totalBrierScore += metrics.brierScore;
    totalBitsScore += metrics.bitsScore;

    if (metrics.marginError !== null) {
      marginErrorSum += metrics.marginError;
      marginPredictionCount += 1;
    }
  });

  return {
    id: predictor?.predictor_id,
    name: predictor?.name,
    display_name: predictor?.display_name,
    tipPoints,
    totalPredictions,
    tipAccuracy: totalPredictions > 0 ? ((tipPoints / totalPredictions) * 100).toFixed(1) : emptyValue,
    brierScore: totalPredictions > 0 ? (totalBrierScore / totalPredictions).toFixed(4) : emptyValue,
    bitsScore: totalPredictions > 0 ? totalBitsScore.toFixed(bitsScoreDigits) : emptyValue,
    marginMAE: marginPredictionCount > 0 ? (marginErrorSum / marginPredictionCount).toFixed(2) : null,
    marginPredictionCount
  };
}

function filterPredictionsByRounds(predictionResults, sourceRounds) {
  if (!Array.isArray(sourceRounds) || sourceRounds.length === 0) {
    return predictionResults;
  }

  const selectedRounds = new Set(sourceRounds);
  return predictionResults.filter((prediction) => selectedRounds.has(prediction.round_number));
}

function buildPredictorStats(predictors, predictorPredictions, options = {}) {
  const {
    includeInactiveWithoutPredictions = true,
    sourceRounds = null,
    bitsScoreDigits = 4,
    emptyValue = 0
  } = options;

  return predictors.reduce((stats, predictor) => {
    const yearPredictions = predictorPredictions.get(predictor.predictor_id) || [];
    const predictionResults = filterPredictionsByRounds(yearPredictions, sourceRounds);

    if (!includeInactiveWithoutPredictions && predictor.active === 0 && predictionResults.length === 0) {
      return stats;
    }

    stats.push(calculatePredictorStats(predictor, predictionResults, {
      bitsScoreDigits,
      emptyValue
    }));
    return stats;
  }, []);
}

function filterAndSortPredictorStats(predictorStats, predictors) {
  const predictorMap = new Map(
    predictors.map((predictor) => [predictor.predictor_id, predictor])
  );

  return predictorStats
    .filter((stat) => {
      const predictor = predictorMap.get(stat.id);
      return predictor && !predictor.is_admin;
    })
    .sort((a, b) => parseFloat(a.brierScore) - parseFloat(b.brierScore));
}

function csvValue(value, forceQuote = false) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  if (forceQuote || /[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvCell(value, forceQuote = false) {
  return { value, forceQuote };
}

function formatExportDate(matchDate) {
  if (!matchDate || typeof matchDate !== 'string' || !matchDate.includes('T')) {
    return matchDate || '';
  }

  const parsedDate = new Date(matchDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return matchDate;
  }

  return parsedDate.toLocaleDateString('en-AU');
}

function getDisplayTippedTeam(prediction, tippedTeam) {
  if (prediction.home_win_probability !== 50) {
    return '';
  }
  return tippedTeam === 'home' ? prediction.home_team : prediction.away_team;
}

function buildPredictionExportRow(prediction) {
  const hasScores = prediction.hscore !== null
    && prediction.hscore !== undefined
    && prediction.ascore !== null
    && prediction.ascore !== undefined;
  const tippedTeam = getTipSide(prediction);
  let correct = '';
  let tipPoints = 0;
  let brierScore = '';
  let bitsScore = '';

  if (hasScores) {
    const metrics = calculatePredictionMetrics(prediction);
    tipPoints = metrics.tipPoints;
    correct = metrics.tipPoints === 1 ? 'Yes' : 'No';
    brierScore = metrics.brierScore.toFixed(4);
    bitsScore = metrics.bitsScore.toFixed(4);
  }

  return [
    csvCell(prediction.predictor_name, true),
    csvCell(prediction.round_number, true),
    csvCell(prediction.match_number),
    csvCell(formatExportDate(prediction.match_date), true),
    csvCell(prediction.home_team, true),
    csvCell(prediction.away_team, true),
    csvCell(prediction.home_win_probability),
    csvCell(100 - prediction.home_win_probability),
    csvCell(getDisplayTippedTeam(prediction, tippedTeam), true),
    csvCell(prediction.hscore ?? ''),
    csvCell(prediction.ascore ?? ''),
    csvCell(correct, true),
    csvCell(tipPoints.toFixed(1)),
    csvCell(brierScore),
    csvCell(bitsScore)
  ];
}

function buildPredictionExportCsv(predictions) {
  const header = [
    'Predictor',
    'Round',
    'Match Number',
    'Match Date',
    'Home Team',
    'Away Team',
    'Home Win %',
    'Away Win %',
    'Tipped Team',
    'Home Score',
    'Away Score',
    'Correct',
    'Tip Points',
    'Brier Score',
    'Bits Score'
  ];

  const rows = predictions.map((prediction) => buildPredictionExportRow(prediction));
  return [
    header.map((value) => csvValue(value)).join(','),
    ...rows.map((row) => row.map((cell) => csvValue(cell.value, cell.forceQuote)).join(','))
  ].join('\n') + '\n';
}

module.exports = {
  buildPredictionExportCsv,
  buildPredictionExportRow,
  buildPredictorStats,
  calculatePredictionMetrics,
  calculatePredictorStats,
  filterAndSortPredictorStats,
  filterPredictionsByRounds,
  getActualOutcome
};
