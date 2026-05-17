(function() {
  let scriptMetadata = null;
  let selectedRunId = null;
  let selectedRunStatus = null;
  let logAfterSeq = 0;
  let refreshTimer = null;
  let isRefreshing = false;

  const RUNNING_STATES = new Set(['queued', 'running']);
  const LEGACY_MARGIN_OPTIMIZE_OUTPUT_PATH = 'data/models/margin/optimal_margin_only_elo_params.json';
  const MARGIN_OPTIMIZE_OUTPUT_PATH_PATTERN = /^data\/models\/margin\/optimal_margin_only_elo_params_trained_to_\d{4}\.json$/;
  const LEGACY_WIN_MARGIN_METHODS_OPTIMIZE_OUTPUT_PATH = 'data/models/win/optimal_margin_methods.json';
  const WIN_MARGIN_METHODS_OPTIMIZE_OUTPUT_PATH_PATTERN = /^data\/models\/win\/optimal_margin_methods_trained_to_\d{4}\.json$/;

  function getCsrfToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    return metaTag ? metaTag.getAttribute('content') : '';
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function setElementHidden(element, hidden) {
    if (!element) {
      return;
    }

    element.classList.toggle('is-hidden', Boolean(hidden));
  }

  function showPageError(message) {
    const errorDiv = getEl('scriptsPageError');
    if (!errorDiv) return;
    errorDiv.textContent = message;
    setElementHidden(errorDiv, false);
  }

  function clearPageError() {
    const errorDiv = getEl('scriptsPageError');
    if (!errorDiv) return;
    errorDiv.textContent = '';
    setElementHidden(errorDiv, true);
  }

  function scriptLabel(scriptKey) {
    if (!scriptMetadata || !Array.isArray(scriptMetadata.scripts)) {
      return scriptKey;
    }

    const found = scriptMetadata.scripts.find((item) => item.key === scriptKey);
    return found ? found.label : scriptKey;
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-AU');
  }

  function escapeHtml(input) {
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function populateSelect(selectId, options, selectedValue, includeEmpty = false, emptyLabel = 'None') {
    const select = getEl(selectId);
    if (!select) return;

    select.innerHTML = '';

    if (includeEmpty) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = emptyLabel;
      emptyOption.selected = selectedValue === undefined || selectedValue === null || selectedValue === '';
      select.appendChild(emptyOption);
    }

    if (!Array.isArray(options) || options.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No options available';
      select.appendChild(empty);
      return;
    }

    options.forEach((option) => {
      const element = document.createElement('option');
      element.value = String(option.value);
      element.textContent = option.label;
      if (selectedValue !== undefined && selectedValue !== null && String(selectedValue) === String(option.value)) {
        element.selected = true;
      }
      select.appendChild(element);
    });
  }

  function getCatalogArtifacts() {
    return scriptMetadata?.modelCatalog?.artifacts || [];
  }

  function getCatalogOutputs() {
    return scriptMetadata?.outputCatalog?.outputs || [];
  }

  function getArtifactByPath(artifactPath) {
    return getCatalogArtifacts().find((artifact) => artifact.path === artifactPath) || null;
  }

  function getPredictionBundle(bundleName) {
    return scriptMetadata?.recommendedBundles?.predictions?.[bundleName] || null;
  }

  function getPredictionProfile(profileName) {
    if (scriptMetadata?.predictionProfiles?.[profileName]) {
      return scriptMetadata.predictionProfiles[profileName];
    }

    if (profileName === 'winFirst') {
      return getPredictionBundle('primary');
    }
    if (profileName === 'marginFirst') {
      return getPredictionBundle('marginOnly');
    }
    return null;
  }

  function normalizeGuidedPredictionMode(mode) {
    return ['marginFirst', 'marginOnly'].includes(mode) ? 'marginFirst' : 'winFirst';
  }

  function getWinFirstAdapterRecord(winModelPath) {
    const profile = getPredictionProfile('winFirst');
    const selectedPath = String(winModelPath || getEl('guidedPredictionWinModelPath')?.value || '');
    if (!selectedPath) {
      return null;
    }

    const mapped = profile?.adaptersByWinModelPath?.[selectedPath];
    if (mapped) {
      return mapped;
    }

    if (profile?.winModel?.path === selectedPath) {
      return {
        winModel: profile.winModel,
        marginMethods: profile.marginMethods || null,
        isCompatible: Boolean(profile.marginMethods)
      };
    }

    return null;
  }

  function getDerivedWinFirstMarginMethods() {
    const profile = getPredictionProfile('winFirst');
    const selectedPath = getEl('guidedPredictionWinModelPath')?.value || '';
    const allowMismatch = Boolean(getEl('guidedPredictionAllowModelMismatch')?.checked);
    const record = getWinFirstAdapterRecord(selectedPath);

    if (record?.marginMethods) {
      return {
        artifact: record.marginMethods,
        isMismatchFallback: false
      };
    }

    if (allowMismatch && profile?.fallbackMarginMethods) {
      return {
        artifact: profile.fallbackMarginMethods,
        isMismatchFallback: true
      };
    }

    return {
      artifact: null,
      isMismatchFallback: false
    };
  }

  function syncGuidedPredictionMarginMethods() {
    const hiddenInput = getEl('guidedPredictionMarginMethodsPath');
    const derived = getDerivedWinFirstMarginMethods();
    const derivedPath = derived.artifact?.path || '';
    if (hiddenInput) {
      hiddenInput.value = derivedPath;
    }
    return derived;
  }

  function getSelectLabel(selectId) {
    const select = getEl(selectId);
    if (!select) {
      return '-';
    }

    const option = Array.from(select.options || [])
      .find((item) => item.value === String(select.value))
      || (select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);
    return option ? option.textContent : (select.value || '-');
  }

  function getPredictorLabel(predictorId) {
    const predictor = (scriptMetadata?.activePredictors || [])
      .find((item) => String(item.predictor_id) === String(predictorId));

    if (!predictor) {
      return predictorId ? `Predictor #${predictorId}` : '-';
    }

    return `${predictor.display_name || predictor.name || 'Predictor'} (#${predictor.predictor_id})`;
  }

  function getArtifactOptions(kinds, fallbackEntries) {
    const allowedKinds = new Set(Array.isArray(kinds) ? kinds : [kinds]);
    const catalogOptions = getCatalogArtifacts()
      .filter((artifact) => allowedKinds.has(artifact.kind))
      .map((artifact) => ({
        value: artifact.path,
        label: artifact.label || artifact.path,
        trainedThroughYear: artifact.trainedThroughYear || 0
      }));

    if (catalogOptions.length > 0) {
      return catalogOptions.sort((left, right) => {
        const yearDiff = right.trainedThroughYear - left.trainedThroughYear;
        if (yearDiff !== 0) {
          return yearDiff;
        }
        return left.label.localeCompare(right.label);
      });
    }

    return (fallbackEntries || []).map((entry) => {
      const artifact = getArtifactByPath(entry);
      return {
        value: entry,
        label: artifact?.label || entry,
        trainedThroughYear: artifact?.trainedThroughYear || extractTrainedToYearFromPath(entry) || 0
      };
    });
  }

  function setSelectSelectedValue(select, selectedValue) {
    if (!select || selectedValue === undefined || selectedValue === null) {
      return;
    }

    const selectedText = String(selectedValue);
    const options = Array.from(select.options || []).map((option) => ({
      value: option.value,
      textContent: option.textContent
    }));

    if (!options.some((option) => String(option.value) === selectedText)) {
      return;
    }

    select.innerHTML = '';
    options.forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.textContent;
      if (String(option.value) === selectedText) {
        element.selected = true;
      }
      select.appendChild(element);
    });
  }

  function getCompactCatalogTitle(entry) {
    const label = String(entry.label || entry.path || '');
    const kindPrefix = entry.kindLabel ? `${entry.kindLabel} - ` : '';
    const withoutKind = kindPrefix && label.startsWith(kindPrefix)
      ? label.slice(kindPrefix.length)
      : label;
    return withoutKind.replace(/\s*\([^()]+\)\s*$/, '');
  }

  function getCatalogEntries() {
    const artifacts = getCatalogArtifacts().map((entry) => ({
      ...entry,
      scope: 'models',
      scopeLabel: 'Model artifacts'
    }));
    const outputs = getCatalogOutputs().map((entry) => ({
      ...entry,
      scope: 'outputs',
      scopeLabel: 'Generated outputs'
    }));

    return [...artifacts, ...outputs].map((entry) => {
      const season = entry.seasonRange
        ? `${entry.seasonRange.startYear || ''} ${entry.seasonRange.endYear || ''}`
        : '';
      const searchText = [
        entry.scopeLabel,
        entry.kindLabel,
        entry.label,
        entry.detail,
        entry.path,
        entry.family,
        entry.trainedThroughYear,
        season,
        entry.modelMode
      ].filter(Boolean).join(' ').toLowerCase();

      return { ...entry, searchText };
    });
  }

  function getCatalogScope() {
    const value = getEl('catalogScopeFilter')?.value || 'models';
    return ['models', 'outputs', 'all'].includes(value) ? value : 'models';
  }

  function getCatalogScopeLabel(scope) {
    if (scope === 'outputs') return 'outputs';
    if (scope === 'all') return 'items';
    return 'artifacts';
  }

  function syncCatalogKindOptions(scopedEntries) {
    const kindFilter = getEl('catalogKindFilter');
    if (!kindFilter) return '';

    const previousValue = kindFilter.value;
    const kinds = [...new Map(scopedEntries.map((entry) => [
      entry.kind,
      entry.kindLabel || entry.kind
    ])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]));

    kindFilter.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All types';
    kindFilter.appendChild(allOption);

    kinds.forEach(([kind, label]) => {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = label;
      kindFilter.appendChild(option);
    });

    const stillAvailable = kinds.some(([kind]) => kind === previousValue);
    kindFilter.value = stillAvailable ? previousValue : '';
    return kindFilter.value;
  }

  function renderCatalogRows(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return '<p class="catalog-empty">No catalogue entries match those filters.</p>';
    }

    return entries.map((entry) => `
      <div class="catalog-row">
        <span class="catalog-kind-badge">${escapeHtml(entry.kindLabel || 'Artifact')}</span>
        <div class="catalog-row-body">
          <strong class="catalog-title">${escapeHtml(getCompactCatalogTitle(entry))}</strong>
          ${entry.detail ? `<span class="catalog-meta">${escapeHtml(entry.detail)}</span>` : ''}
          <code class="catalog-path">${escapeHtml(entry.path)}</code>
        </div>
      </div>
    `).join('');
  }

  function renderCatalogBrowser() {
    const list = getEl('catalogList');
    const count = getEl('catalogResultCount');
    if (!list) return;

    if (!scriptMetadata) {
      list.innerHTML = '<p class="catalog-empty">Loading catalogue...</p>';
      if (count) {
        count.textContent = 'Loading...';
      }
      return;
    }

    const scope = getCatalogScope();
    const allEntries = getCatalogEntries();
    const scopedEntries = scope === 'all'
      ? allEntries
      : allEntries.filter((entry) => entry.scope === scope);
    const selectedKind = syncCatalogKindOptions(scopedEntries);
    const searchText = (getEl('catalogSearch')?.value || '').trim().toLowerCase();

    const filteredEntries = scopedEntries.filter((entry) => {
      const kindMatches = !selectedKind || entry.kind === selectedKind;
      const searchMatches = !searchText || entry.searchText.includes(searchText);
      return kindMatches && searchMatches;
    });

    list.innerHTML = renderCatalogRows(filteredEntries);
    if (count) {
      count.textContent = `${filteredEntries.length}/${scopedEntries.length} ${getCatalogScopeLabel(scope)}`;
    }
  }

  function bindCatalogFilters() {
    ['catalogScopeFilter', 'catalogKindFilter', 'catalogSearch'].forEach((id) => {
      const element = getEl(id);
      if (!element) return;
      element.addEventListener('input', renderCatalogBrowser);
      element.addEventListener('change', renderCatalogBrowser);
    });
  }

  function getRunScope() {
    const scope = document.querySelector('[data-run-scope]')?.getAttribute('data-run-scope') || '';
    return ['models', 'data'].includes(scope) ? scope : '';
  }

  function getRunsUrl() {
    const scope = getRunScope();
    const suffix = scope ? `&scope=${encodeURIComponent(scope)}` : '';
    return `/admin/api/script-runs?limit=30${suffix}`;
  }

  function getGuidedPredictionMode() {
    return normalizeGuidedPredictionMode(getEl('guidedPredictionMode')?.value);
  }

  function setWorkflowPanel(targetId) {
    const panels = document.querySelectorAll('[data-workflow-panel]');
    const buttons = document.querySelectorAll('[data-workflow-target]');

    panels.forEach((panel) => {
      setElementHidden(panel, panel.id !== targetId);
    });

    buttons.forEach((button) => {
      const isActive = button.getAttribute('data-workflow-target') === targetId;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
  }

  function bindWorkflowLauncher() {
    document.querySelectorAll('[data-workflow-target]').forEach((button) => {
      button.addEventListener('click', () => {
        setWorkflowPanel(button.getAttribute('data-workflow-target'));
      });
    });
  }

  function setGuidedPredictionModePanel(mode) {
    const normalizedMode = normalizeGuidedPredictionMode(mode);
    document.querySelectorAll('[data-guided-prediction-mode-panel]').forEach((panel) => {
      const panelModes = (panel.getAttribute('data-guided-prediction-mode-panel') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const normalizedPanelModes = panelModes.map(normalizeGuidedPredictionMode);
      setElementHidden(panel, !normalizedPanelModes.includes(normalizedMode));
    });

    const winModelSelect = getEl('guidedPredictionWinModelPath');
    const marginMethodsSelect = getEl('guidedPredictionMarginMethodsPath');
    const marginModelSelect = getEl('guidedPredictionMarginModelPath');

    if (winModelSelect) {
      winModelSelect.required = normalizedMode === 'winFirst';
    }
    if (marginMethodsSelect) {
      marginMethodsSelect.required = false;
    }
    if (marginModelSelect) {
      marginModelSelect.required = normalizedMode === 'marginFirst';
    }

    const defaults = scriptMetadata?.defaults || {};
    const outputDirInput = getEl('guidedPredictionOutputDir');
    if (outputDirInput) {
      const marginDefault = defaults.marginPredictionsOutputDir || 'data/predictions/margin';
      const recommendedDefault = defaults.winMarginMethodsOutputDir || 'data/predictions/win';
      const currentValue = outputDirInput.value.trim();
      if (!currentValue || [marginDefault, recommendedDefault, defaults.combinedOutputDir].includes(currentValue)) {
        outputDirInput.value = normalizedMode === 'marginFirst' ? marginDefault : recommendedDefault;
      }
    }

    updateGuidedPredictionReview();
  }

  function updateGuidedPredictionReview() {
    const mode = getGuidedPredictionMode();
    const profile = getPredictionProfile(mode);
    const season = getEl('guidedPredictionYear')?.value || '-';
    const predictorId = getEl('guidedPredictionPredictorId')?.value || '';
    const outputDir = getEl('guidedPredictionOutputDir')?.value || '-';
    const overrideCompleted = Boolean(getEl('guidedPredictionOverrideCompleted')?.checked);
    const allowModelMismatch = Boolean(getEl('guidedPredictionAllowModelMismatch')?.checked);
    const derivedMarginMethods = syncGuidedPredictionMarginMethods();
    const adapterRecord = getWinFirstAdapterRecord();

    const predictorReview = getEl('guidedPredictionReviewPredictor');
    const seasonReview = getEl('guidedPredictionReviewSeason');
    const artifactsReview = getEl('guidedPredictionReviewArtifacts');
    const marginAdapterReview = getEl('guidedPredictionReviewMarginAdapter');
    const outputReview = getEl('guidedPredictionReviewOutput');
    const producesReview = getEl('guidedPredictionReviewProduces');
    const safetyReview = getEl('guidedPredictionReviewSafety');
    const profileWarning = getEl('guidedPredictionProfileWarning');

    if (predictorReview) {
      predictorReview.textContent = getPredictorLabel(predictorId);
    }
    if (seasonReview) {
      seasonReview.textContent = season;
    }
    if (artifactsReview) {
      artifactsReview.textContent = mode === 'marginFirst'
        ? getSelectLabel('guidedPredictionMarginModelPath')
        : getSelectLabel('guidedPredictionWinModelPath');
    }
    if (marginAdapterReview) {
      const adapterLabel = derivedMarginMethods.artifact?.label || derivedMarginMethods.artifact?.path || 'No matching margin adapter';
      marginAdapterReview.textContent = derivedMarginMethods.isMismatchFallback
        ? `${adapterLabel} (mismatch bypass)`
        : adapterLabel;
    }
    if (outputReview) {
      outputReview.textContent = `${outputDir}; publish to DB; write normal CSV output`;
    }
    if (producesReview) {
      producesReview.textContent = 'home_win_probability + predicted_margin';
    }
    if (safetyReview) {
      safetyReview.textContent = overrideCompleted
        ? 'Completed or already-started matches may be overwritten.'
        : 'Completed or already-started matches are left untouched.';
      safetyReview.classList.toggle('danger-text', overrideCompleted);
    }
    if (profileWarning) {
      const warnings = Array.isArray(profile?.warnings) ? [...profile.warnings] : [];
      if (mode === 'winFirst' && !derivedMarginMethods.artifact) {
        warnings.push('No compatible margin adapter is available for the selected win-first ratings. Retrain the win-first model or run the advanced adapter backfill.');
      } else if (mode === 'winFirst' && derivedMarginMethods.isMismatchFallback) {
        warnings.push('Model mismatch bypass is enabled; the latest available margin adapter will be used even though it does not match the selected win-first ratings.');
      } else if (mode === 'winFirst' && adapterRecord && adapterRecord.isCompatible === false && !allowModelMismatch) {
        warnings.push(adapterRecord.warning || 'No compatible margin adapter is available for the selected win-first ratings.');
      }
      const uniqueWarnings = [...new Set(warnings)];
      profileWarning.textContent = uniqueWarnings.join(' ');
      setElementHidden(profileWarning, uniqueWarnings.length === 0);
    }
  }

  function bindGuidedPredictionControls() {
    const modeSelect = getEl('guidedPredictionMode');
    if (modeSelect) {
      modeSelect.addEventListener('change', (event) => {
        setGuidedPredictionModePanel(event.target.value);
      });
    }

    [
      'guidedPredictionYear',
      'guidedPredictionPredictorId',
      'guidedPredictionWinModelPath',
      'guidedPredictionMarginModelPath',
      'guidedPredictionOutputDir',
      'guidedPredictionOverrideCompleted',
      'guidedPredictionAllowModelMismatch'
    ].forEach((id) => {
      const element = getEl(id);
      if (!element) return;
      element.addEventListener('input', updateGuidedPredictionReview);
      element.addEventListener('change', updateGuidedPredictionReview);
    });

    setGuidedPredictionModePanel(getGuidedPredictionMode());
  }

  function buildMarginOptimizeOutputPath(endYear) {
    return `data/models/margin/optimal_margin_only_elo_params_trained_to_${endYear}.json`;
  }

  function buildWinMarginMethodsOptimizeOutputPath(endYear) {
    return `data/models/win/optimal_margin_methods_trained_to_${endYear}.json`;
  }

  function extractTrainedToYearFromPath(modelPath) {
    const match = String(modelPath || '').match(/trained_to_(\d{4})\.json$/);
    if (!match) return null;
    return Number.parseInt(match[1], 10);
  }

  function chooseLatestTrainedMarginModel(options) {
    if (!Array.isArray(options) || options.length === 0) {
      return null;
    }

    let best = null;
    options.forEach((option) => {
      const year = extractTrainedToYearFromPath(option.value);
      if (!Number.isInteger(year)) {
        return;
      }

      if (!best || year > best.year) {
        best = { value: option.value, year };
      }
    });

    return best ? best.value : options[0].value;
  }

  function chooseLatestTrainedWinModel(options) {
    if (!Array.isArray(options) || options.length === 0) {
      return null;
    }

    let best = null;
    options.forEach((option) => {
      const year = extractTrainedToYearFromPath(option.value);
      if (!Number.isInteger(year)) {
        return;
      }

      if (!best || year > best.year) {
        best = { value: option.value, year };
      }
    });

    return best ? best.value : options[0].value;
  }

  function getMarginOptimizeEndYear() {
    const endYearInput = getEl('marginOptimizeEndYear');
    const parsed = Number.parseInt(endYearInput ? endYearInput.value : '', 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }

    const currentYear = scriptMetadata?.defaults?.currentYear || new Date().getFullYear();
    return currentYear - 1;
  }

  function setupMarginOptimizeOutputPathSync() {
    const endYearInput = getEl('marginOptimizeEndYear');
    const outputPathInput = getEl('marginOptimizeOutputPath');
    if (!endYearInput || !outputPathInput) {
      return;
    }

    const getSuggestedPath = () => buildMarginOptimizeOutputPath(getMarginOptimizeEndYear());
    const shouldAutoManage = (value) =>
      !value || value === LEGACY_MARGIN_OPTIMIZE_OUTPUT_PATH || MARGIN_OPTIMIZE_OUTPUT_PATH_PATTERN.test(value);
    const currentValue = outputPathInput.value.trim();

    if (shouldAutoManage(currentValue)) {
      outputPathInput.value = getSuggestedPath();
      outputPathInput.dataset.autoManaged = 'true';
    } else {
      outputPathInput.dataset.autoManaged = 'false';
    }

    endYearInput.addEventListener('input', () => {
      if (outputPathInput.dataset.autoManaged === 'true') {
        outputPathInput.value = getSuggestedPath();
      }
    });

    outputPathInput.addEventListener('input', () => {
      const value = outputPathInput.value.trim();
      const suggestedPath = getSuggestedPath();
      outputPathInput.dataset.autoManaged = String(value === suggestedPath || shouldAutoManage(value));
    });
  }

  function getWinMarginMethodsOptimizeEndYear() {
    const endYearInput = getEl('winMarginMethodsOptimizeEndYear');
    const parsed = Number.parseInt(endYearInput ? endYearInput.value : '', 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }

    const currentYear = scriptMetadata?.defaults?.currentYear || new Date().getFullYear();
    return currentYear - 1;
  }

  function setupWinMarginMethodsOptimizeOutputPathSync() {
    const endYearInput = getEl('winMarginMethodsOptimizeEndYear');
    const outputPathInput = getEl('winMarginMethodsOptimizeOutputPath');
    if (!endYearInput || !outputPathInput) {
      return;
    }

    const getSuggestedPath = () => buildWinMarginMethodsOptimizeOutputPath(getWinMarginMethodsOptimizeEndYear());
    const shouldAutoManage = (value) =>
      !value
      || value === LEGACY_WIN_MARGIN_METHODS_OPTIMIZE_OUTPUT_PATH
      || WIN_MARGIN_METHODS_OPTIMIZE_OUTPUT_PATH_PATTERN.test(value);
    const currentValue = outputPathInput.value.trim();

    if (shouldAutoManage(currentValue)) {
      outputPathInput.value = getSuggestedPath();
      outputPathInput.dataset.autoManaged = 'true';
    } else {
      outputPathInput.dataset.autoManaged = 'false';
    }

    endYearInput.addEventListener('input', () => {
      if (outputPathInput.dataset.autoManaged === 'true') {
        outputPathInput.value = getSuggestedPath();
      }
    });

    outputPathInput.addEventListener('input', () => {
      const value = outputPathInput.value.trim();
      const suggestedPath = getSuggestedPath();
      outputPathInput.dataset.autoManaged = String(value === suggestedPath || shouldAutoManage(value));
    });
  }

  function applyMetadataToForm() {
    if (!scriptMetadata) return;

    const defaults = scriptMetadata.defaults || {};
    const currentYear = defaults.currentYear || new Date().getFullYear();

    const yearInputIds = [
      'syncYear',
      'apiRefreshYear',
      'combinedStartYear',
      'guidedPredictionYear',
      'winTrainStartYear',
      'winTrainEndYear',
      'marginOptimizeStartYear',
      'marginOptimizeEndYear',
      'winMarginMethodsOptimizeStartYear',
      'winMarginMethodsOptimizeEndYear',
      'marginTrainStartYear',
      'marginTrainEndYear',
      'historySeedStartYear',
      'historySeedEndYear',
      'historyOutputStartYear',
      'historyOutputEndYear',
      'simYear'
    ];
    const trainingStartYearIds = [
      'winTrainStartYear',
      'marginOptimizeStartYear',
      'winMarginMethodsOptimizeStartYear',
      'marginTrainStartYear'
    ];
    const trainingEndYearIds = [
      'winTrainEndYear',
      'marginOptimizeEndYear',
      'winMarginMethodsOptimizeEndYear',
      'marginTrainEndYear'
    ];

    yearInputIds.forEach((id) => {
      const input = getEl(id);
      if (!input) return;
      if (!input.value && trainingStartYearIds.includes(id)) {
        input.value = '1990';
      }
      if (!input.value && trainingEndYearIds.includes(id)) {
        input.value = String(currentYear - 1);
      }
      if (!input.value && (
        id === 'syncYear' ||
        id === 'apiRefreshYear' ||
        id === 'combinedStartYear' ||
        id === 'guidedPredictionYear' ||
        id === 'simYear'
      )) {
        input.value = String(currentYear);
      }
      if (defaults.yearMax) {
        input.max = String(defaults.yearMax);
      }
    });

    if (getEl('combinedDbPath') && !getEl('combinedDbPath').value) {
      getEl('combinedDbPath').value = defaults.dbPath || '';
    }
    if (getEl('optimizedDbPath') && !getEl('optimizedDbPath').value) {
      getEl('optimizedDbPath').value = defaults.dbPath || '';
    }
    if (getEl('guidedPredictionDbPath') && !getEl('guidedPredictionDbPath').value) {
      getEl('guidedPredictionDbPath').value = defaults.dbPath || '';
    }
    if (getEl('combinedOutputDir') && !getEl('combinedOutputDir').value) {
      getEl('combinedOutputDir').value = defaults.marginPredictionsOutputDir || 'data/predictions/margin';
    }
    if (getEl('optimizedOutputDir') && !getEl('optimizedOutputDir').value) {
      getEl('optimizedOutputDir').value = defaults.winMarginMethodsOutputDir || 'data/predictions/win';
    }
    if (getEl('guidedPredictionOutputDir') && !getEl('guidedPredictionOutputDir').value) {
      getEl('guidedPredictionOutputDir').value = defaults.winMarginMethodsOutputDir || 'data/predictions/win';
    }
    if (getEl('historyDbPath') && !getEl('historyDbPath').value) {
      getEl('historyDbPath').value = defaults.dbPath || '';
    }
    if (getEl('historyOutputDir') && !getEl('historyOutputDir').value) {
      getEl('historyOutputDir').value = defaults.historicalOutputDir || '';
    }
    if (getEl('historyOutputPrefix') && !getEl('historyOutputPrefix').value) {
      getEl('historyOutputPrefix').value = defaults.historicalOutputPrefix || '';
    }
    if (getEl('historyMode') && !getEl('historyMode').value) {
      getEl('historyMode').value = defaults.historicalMode || 'incremental';
    }
    if (getEl('historySeedStartYear') && !getEl('historySeedStartYear').value) {
      getEl('historySeedStartYear').value = String(defaults.historicalSeedStartYear || 1990);
    }
    if (getEl('historyOutputStartYear') && !getEl('historyOutputStartYear').value) {
      getEl('historyOutputStartYear').value = String(defaults.historicalOutputStartYear || 2000);
    }
    if (getEl('simDbPath') && !getEl('simDbPath').value) {
      getEl('simDbPath').value = defaults.dbPath || '';
    }
    if (getEl('winTrainDbPath') && !getEl('winTrainDbPath').value) {
      getEl('winTrainDbPath').value = defaults.dbPath || '';
    }
    if (getEl('marginTrainDbPath') && !getEl('marginTrainDbPath').value) {
      getEl('marginTrainDbPath').value = defaults.dbPath || '';
    }
    if (getEl('marginOptimizeDbPath') && !getEl('marginOptimizeDbPath').value) {
      getEl('marginOptimizeDbPath').value = defaults.dbPath || '';
    }
    if (getEl('winMarginMethodsOptimizeDbPath') && !getEl('winMarginMethodsOptimizeDbPath').value) {
      getEl('winMarginMethodsOptimizeDbPath').value = defaults.dbPath || '';
    }
    if (getEl('winTrainOutputDir') && !getEl('winTrainOutputDir').value) {
      getEl('winTrainOutputDir').value = defaults.winModelOutputDir || 'data/models/win';
    }
    if (getEl('marginTrainOutputDir') && !getEl('marginTrainOutputDir').value) {
      getEl('marginTrainOutputDir').value = defaults.marginModelOutputDir || 'data/models/margin';
    }
    if (getEl('marginOptimizeOutputPath') && !getEl('marginOptimizeOutputPath').value) {
      getEl('marginOptimizeOutputPath').value =
        defaults.marginOptimizeOutputPath || buildMarginOptimizeOutputPath(currentYear - 1);
    }
    if (getEl('winMarginMethodsOptimizeOutputPath') && !getEl('winMarginMethodsOptimizeOutputPath').value) {
      getEl('winMarginMethodsOptimizeOutputPath').value =
        defaults.winMarginMethodsOptimizeOutputPath || buildWinMarginMethodsOptimizeOutputPath(currentYear - 1);
    }
    if (getEl('simNumSimulations') && !getEl('simNumSimulations').value) {
      getEl('simNumSimulations').value = '50000';
    }
    if (getEl('winTrainCvFolds') && !getEl('winTrainCvFolds').value) {
      getEl('winTrainCvFolds').value = '3';
    }
    if (getEl('winTrainMaxCombinations') && !getEl('winTrainMaxCombinations').value) {
      getEl('winTrainMaxCombinations').value = '500';
    }
    if (getEl('marginTrainEndYear') && !getEl('marginTrainEndYear').value) {
      getEl('marginTrainEndYear').value = String(currentYear - 1);
    }
    if (getEl('marginOptimizeEndYear') && !getEl('marginOptimizeEndYear').value) {
      getEl('marginOptimizeEndYear').value = String(currentYear - 1);
    }
    if (getEl('winMarginMethodsOptimizeEndYear') && !getEl('winMarginMethodsOptimizeEndYear').value) {
      getEl('winMarginMethodsOptimizeEndYear').value = String(currentYear - 1);
    }
    if (getEl('marginOptimizeMaxCombinations') && !getEl('marginOptimizeMaxCombinations').value) {
      getEl('marginOptimizeMaxCombinations').value = '500';
    }
    if (getEl('winMarginMethodsOptimizeNCalls') && !getEl('winMarginMethodsOptimizeNCalls').value) {
      getEl('winMarginMethodsOptimizeNCalls').value = '100';
    }
    if (getEl('winMarginMethodsOptimizeRandomSeed') && !getEl('winMarginMethodsOptimizeRandomSeed').value) {
      getEl('winMarginMethodsOptimizeRandomSeed').value = '42';
    }

    const allWinFiles = scriptMetadata.modelFiles?.win || [];
    const allMarginFiles = scriptMetadata.modelFiles?.margin || [];
    const winModelEntries = scriptMetadata.modelFiles?.winModels
      || allWinFiles.filter((entry) => /afl_elo_win_trained_to_\d{4}\.json$/i.test(entry));
    const winParamsEntries = scriptMetadata.modelFiles?.winParams
      || allWinFiles.filter((entry) => /optimal_elo_params_win(?:_trained_to_\d{4})?\.json$/i.test(entry));
    const winModelOrParamsEntries = scriptMetadata.modelFiles?.winModelOrParams
      || allWinFiles.filter((entry) =>
        /afl_elo_win_trained_to_\d{4}\.json$/i.test(entry)
        || /optimal_elo_params_win(?:_trained_to_\d{4})?\.json$/i.test(entry)
      );
    const marginModelEntries = allMarginFiles.filter((entry) => /afl_elo_margin_only_trained_to_\d{4}\.json$/i.test(entry));
    const marginParamsEntries = allMarginFiles.filter((entry) => /optimal_margin_only_elo_params(?:_trained_to_\d{4})?\.json$/i.test(entry));

    const winModelOptions = getArtifactOptions('trained_win_model', winModelEntries);
    const winParamsOptions = getArtifactOptions('win_params', winParamsEntries);
    const winModelOrParamsOptions = getArtifactOptions(['trained_win_model', 'win_params'], winModelOrParamsEntries);
    const winMarginMethodsOptions = getArtifactOptions(
      'win_margin_methods',
      scriptMetadata.modelFiles?.winMarginMethods
      || allWinFiles.filter((entry) => /optimal_margin_methods/i.test(entry))
    );
    const marginModelOptions = getArtifactOptions('trained_margin_model', marginModelEntries);
    const marginParamsOptions = getArtifactOptions('margin_params', marginParamsEntries);
    const historyModelOptions = getArtifactOptions(
      ['trained_margin_model', 'trained_win_model'],
      scriptMetadata.modelFiles?.history || [...marginModelEntries, ...winModelEntries]
    );
    const defaultMarginModelPath = chooseLatestTrainedMarginModel(marginModelOptions);
    const defaultWinModelPath = chooseLatestTrainedWinModel(winModelOptions);
    const defaultHistoryModelPath = defaultMarginModelPath || (historyModelOptions[0] ? historyModelOptions[0].value : null);
    const winFirstProfile = getPredictionProfile('winFirst');
    const marginFirstProfile = getPredictionProfile('marginFirst');
    const winFirstCompatible = Boolean(winFirstProfile?.isCompatible);
    const recommendedWinModelPath = winFirstCompatible
      ? winFirstProfile?.winModel?.path
      : null;
    const recommendedMarginModelPath = marginFirstProfile?.model?.path || defaultMarginModelPath;

    populateSelect('optimizedWinModelPath', winModelOptions, defaultWinModelPath);
    populateSelect(
      'guidedPredictionWinModelPath',
      winModelOptions,
      recommendedWinModelPath,
      !winFirstCompatible,
      'Select win-first ratings'
    );
    populateSelect(
      'winMarginMethodsOptimizeEloParamsPath',
      winModelOrParamsOptions,
      defaultWinModelPath || (winModelOrParamsOptions[0] ? winModelOrParamsOptions[0].value : null)
    );
    populateSelect('historyModelPath', historyModelOptions, defaultHistoryModelPath);
    populateSelect('combinedMarginModelPath', marginModelOptions, defaultMarginModelPath);
    populateSelect('optimizedMarginMethodsPath', winMarginMethodsOptions, winMarginMethodsOptions[0] ? winMarginMethodsOptions[0].value : null);
    populateSelect('guidedPredictionMarginModelPath', marginModelOptions, recommendedMarginModelPath);
    populateSelect('simModelPath', marginModelOptions, defaultMarginModelPath);
    populateSelect('simWinModelPath', winModelOptions, null, true);
    populateSelect('winTrainParamsFile', winParamsOptions, (winParamsOptions[0] || {}).value, true);
    populateSelect(
      'marginTrainParamsFile',
      marginParamsOptions,
      (marginParamsOptions.find((option) => option.value.includes('optimal_margin_only_elo_params')) || marginParamsOptions[0] || {}).value
    );

    const predictorOptions = (scriptMetadata.activePredictors || []).map((predictor) => ({
      value: predictor.predictor_id,
      label: `${predictor.display_name} (#${predictor.predictor_id})`
    }));

    populateSelect('combinedPredictorId', predictorOptions, defaults.marginPredictorId || defaults.predictorId);
    populateSelect('optimizedPredictorId', predictorOptions, defaults.winMarginMethodsPredictorId || defaults.predictorId);
    populateSelect(
      'guidedPredictionPredictorId',
      predictorOptions,
      null,
      true,
      'Select target predictor'
    );
    setGuidedPredictionModePanel(getGuidedPredictionMode());
    syncGuidedPredictionMarginMethods();
    renderCatalogBrowser();
  }

  async function loadMetadata() {
    const response = await fetch('/admin/api/script-metadata');
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to load script metadata');
    }

    scriptMetadata = data;
    applyMetadataToForm();
  }

  function getFormParams(form) {
    const params = {};
    const fields = form.querySelectorAll('input[name], select[name], textarea[name]');

    fields.forEach((field) => {
      const name = field.name;
      if (!name) return;

      if (field.type === 'checkbox') {
        params[name] = field.checked;
        return;
      }

      const value = field.value !== undefined ? field.value.trim() : '';
      if (value === '') {
        return;
      }

      params[name] = value;
    });

    return params;
  }

  function setFormsDisabled(disabled) {
    const forms = document.querySelectorAll('.script-run-form');
    forms.forEach((form) => {
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = disabled;
      }
    });
  }

  function updateActiveRunBanner(activeRun) {
    const banner = getEl('activeRunBanner');
    if (!banner) return;

    if (!activeRun) {
      setElementHidden(banner, true);
      banner.textContent = '';
      setFormsDisabled(false);
      return;
    }

    setElementHidden(banner, false);
    banner.textContent = `Run #${activeRun.run_id} (${scriptLabel(activeRun.script_key)}) is ${activeRun.status}. New runs are blocked until completion.`;
    setFormsDisabled(true);
  }

  function renderHistory(runs) {
    const tbody = getEl('scriptRunHistoryBody');
    if (!tbody) return;

    if (!Array.isArray(runs) || runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">No runs yet.</td></tr>';
      return;
    }

    tbody.innerHTML = runs.map((run) => {
      const statusClass = `status-${run.status}`;
      const isSelected = selectedRunId === run.run_id;

      return `
        <tr class="${isSelected ? 'selected-run-row' : ''}">
          <td>${run.run_id}</td>
          <td>${escapeHtml(scriptLabel(run.script_key))}</td>
          <td><span class="run-status-badge ${statusClass}">${escapeHtml(run.status)}</span></td>
          <td>${escapeHtml(formatDateTime(run.started_at || run.created_at))}</td>
          <td>${escapeHtml(formatDateTime(run.finished_at))}</td>
          <td>${escapeHtml(run.created_by_name || String(run.created_by_predictor_id || '-'))}</td>
          <td>
            <button class="button secondary-button" data-action="view-run-logs" data-run-id="${run.run_id}">
              View Logs
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function refreshRuns() {
    const response = await fetch(getRunsUrl());
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to load run history');
    }

    const runs = Array.isArray(data.runs) ? data.runs : [];
    renderHistory(runs);

    const activeRun = data.activeRun
      || runs.find((run) => RUNNING_STATES.has(run.status))
      || null;

    updateActiveRunBanner(activeRun);

    if (selectedRunId !== null) {
      const selected = runs.find((run) => run.run_id === selectedRunId);
      if (selected) {
        selectedRunStatus = selected.status;
        const logRunLabel = getEl('logRunLabel');
        if (logRunLabel) {
          logRunLabel.textContent = `Logs for run #${selected.run_id} (${scriptLabel(selected.script_key)}) - ${selected.status}`;
        }
      }
    }
  }

  function appendLogs(logs) {
    const output = getEl('scriptLogsOutput');
    if (!output || !Array.isArray(logs) || logs.length === 0) {
      return;
    }

    const lines = logs.map((entry) => {
      const timestamp = formatDateTime(entry.created_at);
      return `[${timestamp}] [${entry.stream}] ${entry.message}`;
    });

    if (output.textContent === 'No logs loaded.' || output.textContent === 'No logs available for this run yet.') {
      output.textContent = lines.join('\n');
    } else {
      output.textContent += `\n${lines.join('\n')}`;
    }

    output.scrollTop = output.scrollHeight;
  }

  async function refreshSelectedRunLogs() {
    if (!selectedRunId) {
      return;
    }

    const response = await fetch(`/admin/api/script-runs/${selectedRunId}/logs?afterSeq=${logAfterSeq}&limit=500`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch logs');
    }

    appendLogs(data.logs);
    logAfterSeq = data.lastSeq || logAfterSeq;

    if (selectedRunStatus && !RUNNING_STATES.has(selectedRunStatus) && data.logs.length === 0) {
      return;
    }
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    clearPageError();

    const form = event.currentTarget;
    const baseScriptKey = form.getAttribute('data-script-key');
    let scriptKey = baseScriptKey;
    if (!scriptKey) {
      showPageError('Missing script key for form submission');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Starting...';
    }

    try {
      const params = getFormParams(form);

      if (baseScriptKey === 'guided-predictions') {
        const predictionMode = normalizeGuidedPredictionMode(params.predictionMode);
        delete params.predictionMode;

        if (predictionMode === 'marginFirst') {
          scriptKey = 'margin-predictions';
          delete params.winModelPath;
          delete params.marginMethodsPath;
          delete params.futureOnly;
          delete params.methodOverride;
          delete params.allowModelMismatch;
        } else {
          scriptKey = 'win-margin-methods-predictions';
          const derivedMarginMethods = syncGuidedPredictionMarginMethods();
          if (!derivedMarginMethods.artifact?.path) {
            throw new Error('No compatible margin adapter is available for the selected win-first ratings. Retrain the win-first model or run the advanced adapter backfill.');
          }
          params.marginMethodsPath = derivedMarginMethods.artifact.path;
          delete params.modelPath;
        }
      }

      if (baseScriptKey === 'combined-predictions') {
        const allowedModes = new Set(['optimized', 'margin']);
        const predictionMode = allowedModes.has(params.predictionMode) ? params.predictionMode : 'optimized';
        delete params.predictionMode;

        if (predictionMode === 'margin') {
          scriptKey = 'margin-predictions';
          params.modelPath = params.marginModelPath;
          delete params.optimizedWinModelPath;
          delete params.optimizedMarginMethodsPath;
          delete params.optimizedPredictorId;
          delete params.optimizedDbPath;
          delete params.optimizedOutputDir;
          delete params.optimizedFutureOnly;
          delete params.optimizedOverrideCompleted;
          delete params.optimizedSaveToDb;
          delete params.optimizedMethodOverride;
          delete params.optimizedAllowModelMismatch;
          delete params.methodOverride;
          delete params.allowModelMismatch;
          delete params.futureOnly;
        } else {
          scriptKey = 'win-margin-methods-predictions';
          params.winModelPath = params.optimizedWinModelPath;
          params.marginMethodsPath = params.optimizedMarginMethodsPath;
          params.predictorId = params.optimizedPredictorId;
          params.dbPath = params.optimizedDbPath;
          params.outputDir = params.optimizedOutputDir;
          params.futureOnly = params.optimizedFutureOnly;
          params.overrideCompleted = params.optimizedOverrideCompleted;
          params.saveToDb = params.optimizedSaveToDb;
          params.methodOverride = params.optimizedMethodOverride;
          params.allowModelMismatch = params.optimizedAllowModelMismatch;
          delete params.marginModelPath;
          delete params.modelPath;
          delete params.optimizedWinModelPath;
          delete params.optimizedMarginMethodsPath;
          delete params.optimizedPredictorId;
          delete params.optimizedDbPath;
          delete params.optimizedOutputDir;
          delete params.optimizedFutureOnly;
          delete params.optimizedOverrideCompleted;
          delete params.optimizedSaveToDb;
          delete params.optimizedMethodOverride;
          delete params.optimizedAllowModelMismatch;
          delete params.combinedPredictorId;
        }
      }

      const response = await fetch('/admin/api/script-runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({ scriptKey, params })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to start script run');
      }

      selectedRunId = data.run.runId;
      selectedRunStatus = data.run.status;
      logAfterSeq = 0;

      const output = getEl('scriptLogsOutput');
      if (output) {
        output.textContent = 'Waiting for logs...';
      }

      const logRunLabel = getEl('logRunLabel');
      if (logRunLabel) {
        logRunLabel.textContent = `Logs for run #${selectedRunId} (${scriptLabel(scriptKey)})`;
      }

      await refreshRuns();
      await refreshSelectedRunLogs();
    } catch (error) {
      showPageError(error.message);
    } finally {
      if (submitButton) {
        const activeBanner = getEl('activeRunBanner');
        const hasActiveRun = activeBanner && !activeBanner.classList.contains('is-hidden');
        submitButton.disabled = !!hasActiveRun;
        submitButton.textContent = submitButton.dataset.defaultLabel || 'Run';
      }
    }
  }

  function initializeSubmitButtons() {
    document.querySelectorAll('.script-run-form button[type="submit"]').forEach((button) => {
      button.dataset.defaultLabel = button.textContent;
    });
  }

  function bindFormHandlers() {
    document.querySelectorAll('.script-run-form').forEach((form) => {
      form.addEventListener('submit', handleFormSubmit);
    });
  }

  function bindHistoryActions() {
    const tbody = getEl('scriptRunHistoryBody');
    if (!tbody) return;

    tbody.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action="view-run-logs"]');
      if (!button) return;

      const runId = Number.parseInt(button.getAttribute('data-run-id'), 10);
      if (!Number.isInteger(runId) || runId <= 0) {
        return;
      }

      clearPageError();
      selectedRunId = runId;
      selectedRunStatus = null;
      logAfterSeq = 0;

      const output = getEl('scriptLogsOutput');
      if (output) {
        output.textContent = 'Loading logs...';
      }

      try {
        const runResponse = await fetch(`/admin/api/script-runs/${runId}`);
        const runData = await runResponse.json();

        if (!runResponse.ok || !runData.success) {
          throw new Error(runData.error || 'Unable to load run details');
        }

        selectedRunStatus = runData.run.status;

        const logRunLabel = getEl('logRunLabel');
        if (logRunLabel) {
          logRunLabel.textContent = `Logs for run #${runId} (${scriptLabel(runData.run.script_key)}) - ${runData.run.status}`;
        }

        if (output) {
          output.textContent = 'No logs available for this run yet.';
        }

        await refreshSelectedRunLogs();
        await refreshRuns();
      } catch (error) {
        showPageError(error.message);
      }
    });
  }

  function setPredictionsModePanel(mode) {
    const normalizedMode = ['optimized', 'margin'].includes(mode) ? mode : 'optimized';
    document.querySelectorAll('[data-predictions-mode-panel]').forEach((panel) => {
      const panelModes = (panel.getAttribute('data-predictions-mode-panel') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      setElementHidden(panel, !panelModes.includes(normalizedMode));
    });

    const optimizedWinModelSelect = getEl('optimizedWinModelPath');
    if (optimizedWinModelSelect) {
      optimizedWinModelSelect.required = normalizedMode === 'optimized';
    }
    const marginModelSelect = getEl('combinedMarginModelPath');
    if (marginModelSelect) {
      marginModelSelect.required = normalizedMode === 'margin';
    }
    const optimizedMethodsSelect = getEl('optimizedMarginMethodsPath');
    if (optimizedMethodsSelect) {
      optimizedMethodsSelect.required = normalizedMode === 'optimized';
    }
    const combinedPredictorSelect = getEl('combinedPredictorId');
    if (combinedPredictorSelect) {
      combinedPredictorSelect.required = normalizedMode === 'margin';
    }
    const optimizedPredictorSelect = getEl('optimizedPredictorId');
    if (optimizedPredictorSelect) {
      optimizedPredictorSelect.required = normalizedMode === 'optimized';
    }

    const outputDirInput = getEl(normalizedMode === 'optimized' ? 'optimizedOutputDir' : 'combinedOutputDir');
    if (outputDirInput) {
      const defaults = scriptMetadata?.defaults || {};
      const combinedDefault = defaults.combinedOutputDir || 'data/predictions/combined';
      const marginDefault = defaults.marginPredictionsOutputDir || 'data/predictions/margin';
      const optimizedDefault = defaults.winMarginMethodsOutputDir || 'data/predictions/win';
      const currentValue = outputDirInput.value.trim();

      if (!currentValue
        || currentValue === combinedDefault
        || currentValue === marginDefault
        || currentValue === optimizedDefault) {
        if (normalizedMode === 'margin') {
          outputDirInput.value = marginDefault;
        } else if (normalizedMode === 'optimized') {
          outputDirInput.value = optimizedDefault;
        } else {
          outputDirInput.value = combinedDefault;
        }
      }
    }
  }

  function bindPredictionsModeToggle() {
    const modeSelect = getEl('predictionsMode');
    if (!modeSelect) {
      return;
    }

    modeSelect.addEventListener('change', (event) => {
      setPredictionsModePanel(event.target.value);
    });

    setPredictionsModePanel(modeSelect.value);
  }

  function setTrainingModePanel(mode) {
    const normalizedMode = mode === 'margin' ? 'margin' : 'win';
    document.querySelectorAll('[data-train-mode-panel]').forEach((panel) => {
      const panelMode = panel.getAttribute('data-train-mode-panel');
      setElementHidden(panel, panelMode !== normalizedMode);
    });
  }

  function bindTrainingModeToggle() {
    const modeSelect = getEl('trainOptimizationTarget');
    if (!modeSelect) {
      return;
    }

    modeSelect.addEventListener('change', (event) => {
      setTrainingModePanel(event.target.value);
    });

    setTrainingModePanel(modeSelect.value);
  }

  async function refreshLoop() {
    if (isRefreshing) {
      return;
    }

    isRefreshing = true;
    try {
      await refreshRuns();
      if (selectedRunId !== null) {
        await refreshSelectedRunLogs();
      }
    } catch (error) {
      showPageError(error.message);
    } finally {
      isRefreshing = false;
    }
  }

  async function initialize() {
    initializeSubmitButtons();
    bindFormHandlers();
    bindHistoryActions();
    bindWorkflowLauncher();
    bindGuidedPredictionControls();
    bindPredictionsModeToggle();
    bindTrainingModeToggle();
    bindCatalogFilters();

    try {
      await loadMetadata();
      setPredictionsModePanel(getEl('predictionsMode') ? getEl('predictionsMode').value : 'optimized');
      setGuidedPredictionModePanel(getGuidedPredictionMode());
      setupMarginOptimizeOutputPathSync();
      setupWinMarginMethodsOptimizeOutputPathSync();
      await refreshRuns();
    } catch (error) {
      showPageError(error.message);
    }

    refreshTimer = window.setInterval(refreshLoop, 2000);
  }

  document.addEventListener('DOMContentLoaded', initialize);

  window.addEventListener('beforeunload', () => {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
    }
  });
})();
