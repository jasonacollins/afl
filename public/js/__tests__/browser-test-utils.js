const path = require('path');
const { parseHTML } = require('linkedom');

function createDom(html, options = {}) {
  const { window, document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const location = new URL(options.url || 'https://example.test/predictions?year=2026');

  Object.defineProperty(window, 'location', {
    value: location,
    configurable: true,
    enumerable: true
  });

  if (typeof window.close !== 'function') {
    window.close = function close() {};
  }

  let activeElement = null;
  Object.defineProperty(document, 'activeElement', {
    get() {
      return activeElement;
    },
    configurable: true
  });

  const focus = function focus() {
    activeElement = this;
  };
  window.HTMLElement.prototype.focus = focus;

  return { window, document };
}

function installDomGlobals(dom) {
  const previous = {};
  const mappings = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent || dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent || dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    FormData: dom.window.FormData || FormData,
    URLSearchParams: dom.window.URLSearchParams || URLSearchParams
  };

  Object.entries(mappings).forEach(([key, value]) => {
    previous[key] = global[key];
    global[key] = value;
  });

  return function restoreDomGlobals() {
    Object.keys(mappings).forEach((key) => {
      if (typeof previous[key] === 'undefined') {
        delete global[key];
        return;
      }

      global[key] = previous[key];
    });
  };
}

function loadBrowserScript(fileName) {
  return require(path.join(__dirname, '..', fileName));
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  createDom,
  installDomGlobals,
  loadBrowserScript,
  flushPromises
};
