const {
  createDom,
  installDomGlobals,
  loadBrowserScript
} = require('./browser-test-utils');

describe('public/js/mobile-nav.js', () => {
  let dom;
  let restoreDomGlobals;
  let mobileViewport;

  beforeEach(() => {
    jest.resetModules();

    dom = createDom(`
      <header class="site-header">
        <button class="mobile-nav-toggle" aria-expanded="false">Menu</button>
        <nav id="site-menu">
          <a href="/predictions">Predictions</a>
        </nav>
      </header>
      <main id="outside">Outside</main>
    `);
    restoreDomGlobals = installDomGlobals(dom);

    mobileViewport = true;
    window.matchMedia = jest.fn(() => ({
      get matches() {
        return mobileViewport;
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));
  });

  afterEach(() => {
    restoreDomGlobals();
    dom.window.close();
  });

  test('opens, closes, and restores focus in the mobile menu flow', () => {
    loadBrowserScript('mobile-nav.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const toggleButton = document.querySelector('.mobile-nav-toggle');
    const menu = document.getElementById('site-menu');
    const firstLink = menu.querySelector('a');
    const header = document.querySelector('.site-header');

    expect(header.classList.contains('mobile-nav-ready')).toBe(true);

    toggleButton.click();
    expect(menu.classList.contains('is-open')).toBe(true);
    expect(toggleButton.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(firstLink);

    const escapeEvent = new window.KeyboardEvent('keydown', { bubbles: true });
    escapeEvent.key = 'Escape';
    document.dispatchEvent(escapeEvent);
    expect(menu.classList.contains('is-open')).toBe(false);
    expect(toggleButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggleButton);
  });

  test('closes when clicking outside on mobile and when resizing to desktop', () => {
    loadBrowserScript('mobile-nav.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const toggleButton = document.querySelector('.mobile-nav-toggle');
    const menu = document.getElementById('site-menu');

    toggleButton.click();
    expect(menu.classList.contains('is-open')).toBe(true);

    document.getElementById('outside').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(menu.classList.contains('is-open')).toBe(false);

    toggleButton.click();
    expect(menu.classList.contains('is-open')).toBe(true);

    mobileViewport = false;
    window.dispatchEvent(new window.Event('resize'));
    expect(menu.classList.contains('is-open')).toBe(false);
  });

  test('closes after clicking a menu link on mobile and safely skips missing markup', () => {
    loadBrowserScript('mobile-nav.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const toggleButton = document.querySelector('.mobile-nav-toggle');
    const menu = document.getElementById('site-menu');
    const link = menu.querySelector('a');

    toggleButton.click();
    expect(menu.classList.contains('is-open')).toBe(true);

    link.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(menu.classList.contains('is-open')).toBe(false);

    const sparseDom = createDom('<main>No nav</main>');
    const restoreSparseGlobals = installDomGlobals(sparseDom);
    window.matchMedia = jest.fn(() => ({
      get matches() {
        return true;
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));

    jest.resetModules();
    expect(() => {
      loadBrowserScript('mobile-nav.js');
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }).not.toThrow();

    restoreSparseGlobals();
    sparseDom.window.close();
  });
});
