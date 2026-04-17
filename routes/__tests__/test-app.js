const express = require('express');
const { errorMiddleware } = require('../../utils/error-handler');

function createSession(sessionData) {
  const baseSession = typeof sessionData === 'function' ? sessionData() : { ...(sessionData || {}) };
  const session = {
    ...baseSession,
    destroy: baseSession.destroy || function destroy(callback) {
      if (typeof callback === 'function') {
        callback(null);
      }
    },
    regenerate: baseSession.regenerate || function regenerate(callback) {
      delete this.user;
      delete this.isAdmin;
      if (typeof callback === 'function') {
        callback(null);
      }
    },
    save: baseSession.save || function save(callback) {
      if (typeof callback === 'function') {
        callback(null);
      }
    }
  };

  return session;
}

function createRouterTestApp(router, options = {}) {
  const app = express();
  const sessionData = options.sessionData || {};

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use((req, res, next) => {
    req.session = createSession(sessionData);
    next();
  });

  app.response.render = function render(view, locals) {
    return this.json({
      view,
      locals
    });
  };

  app.use(router);
  app.use(errorMiddleware);

  return app;
}

module.exports = {
  createRouterTestApp
};
