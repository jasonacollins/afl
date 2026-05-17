const {
  createDom,
  installDomGlobals,
  loadBrowserScript
} = require('./browser-test-utils');

describe('public/js/predictions.js', () => {
  let dom;
  let restoreDomGlobals;

  function installPredictionsDom(html) {
    dom = createDom(html);
    restoreDomGlobals = installDomGlobals(dom);
  }

  beforeEach(() => {
    jest.resetModules();

    installPredictionsDom(`
      <div class="predictions-container"
           data-predictions='{"44":{"probability":50,"tippedTeam":"home"}}'
           data-is-admin="true"></div>
      <div id="team-selection-44">
        <button class="team-button home-team-button selected" data-team="home" data-match-id="44">Cats</button>
        <button class="team-button away-team-button" data-team="away" data-match-id="44">Swans</button>
      </div>
      <button class="save-prediction" data-match-id="44" data-tipped-team="home">Save</button>
    `);
  });

  afterEach(() => {
    delete window.userPredictions;
    delete window.isAdmin;
    restoreDomGlobals();
    dom.window.close();
  });

  test('initializes page globals from the predictions container', () => {
    loadBrowserScript('predictions.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(window.userPredictions).toEqual({
      44: {
        probability: 50,
        tippedTeam: 'home'
      }
    });
    expect(window.isAdmin).toBe(true);
  });

  test('initializes empty predictions and non-admin status', () => {
    restoreDomGlobals();
    dom.window.close();

    installPredictionsDom(`
      <div class="predictions-container" data-predictions="" data-is-admin="false"></div>
      <div id="team-selection-55">
        <button class="team-button home-team-button" data-team="home" data-match-id="55">Dockers</button>
        <button class="team-button away-team-button selected" data-team="away" data-match-id="55">Eagles</button>
      </div>
    `);

    loadBrowserScript('predictions.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(window.userPredictions).toEqual({});
    expect(window.isAdmin).toBe(false);
  });

  test('does not bind team selection buttons when bootstrapping globals', () => {
    restoreDomGlobals();
    dom.window.close();

    installPredictionsDom(`
      <div id="team-selection-77">
        <button class="team-button home-team-button" data-team="home" data-match-id="77">Cats</button>
        <button class="team-button away-team-button selected" data-team="away" data-match-id="77">Swans</button>
      </div>
    `);

    loadBrowserScript('predictions.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    document.querySelector('.home-team-button').click();

    expect(window.userPredictions).toBeUndefined();
    expect(window.isAdmin).toBeUndefined();
    expect(document.querySelector('.home-team-button').classList.contains('selected')).toBe(false);
    expect(document.querySelector('.away-team-button').classList.contains('selected')).toBe(true);
  });
});
