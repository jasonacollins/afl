const {
  createDom,
  installDomGlobals,
  loadBrowserScript
} = require('./browser-test-utils');

describe('public/js/predictions.js', () => {
  let dom;
  let restoreDomGlobals;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <div class="predictions-container"
           data-predictions='{"44":{"probability":50,"tippedTeam":"home"}}'
           data-is-admin="true"></div>
      <div id="team-selection-44">
        <button class="team-button home-team-button selected" data-team="home" data-match-id="44">Cats</button>
        <button class="team-button away-team-button" data-team="away" data-match-id="44">Swans</button>
      </div>
      <button class="save-prediction" data-match-id="44" data-tipped-team="home">Save</button>
    `);
    restoreDomGlobals = installDomGlobals(dom);
  });

  afterEach(() => {
    restoreDomGlobals();
    dom.window.close();
  });

  test('initializes page globals and updates the selected tipped team', () => {
    loadBrowserScript('predictions.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(window.userPredictions).toEqual({
      44: {
        probability: 50,
        tippedTeam: 'home'
      }
    });
    expect(window.isAdmin).toBe(true);

    document.querySelector('.away-team-button').click();

    expect(document.querySelector('.away-team-button').classList.contains('selected')).toBe(true);
    expect(document.querySelector('.home-team-button').classList.contains('selected')).toBe(false);
    expect(document.querySelector('.save-prediction').dataset.tippedTeam).toBe('away');
  });
});
