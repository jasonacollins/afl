const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const path = require('path');
const methodOverride = require('method-override');
const helmet = require('helmet');
const { getConfig, getValidatedConfig, validateConfig } = require('./config');

// Import utilities
const { AppError, errorMiddleware } = require('./utils/error-handler');
const { logger, requestLogger } = require('./utils/logger');
const { initializeDatabase } = require('./models/db');
const csrfProtection = require('./middleware/csrf');

// Import services
const adminScriptRunner = require('./services/admin-script-runner');
const eventSyncService = require('./services/event-sync-service');
const resultUpdateService = require('./services/result-update-service');
const databaseHealthService = require('./services/database-health-service');

// Import routes
const authRoutes = require('./routes/auth');
const predictionsRoutes = require('./routes/predictions');
const matchesRoutes = require('./routes/matches');
const adminRoutes = require('./routes/admin');
const eloRoutes = require('./routes/elo');
const simulationRoutes = require('./routes/simulation');
const homeRoutes = require('./routes/home');
const pageRoutes = require('./routes/pages');

function createSessionStore() {
  return new SqliteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'data/database')
  });
}

function getSessionSecret(explicitSecret, runtimeConfig = getConfig()) {
  return explicitSecret || runtimeConfig.sessionSecret;
}

function registerAppRoutes(app) {
  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  // Serve the scoring service as a client-side script
  app.get('/js/scoring-service.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'services', 'scoring-service.js'));
  });

  // Favicon route to prevent 404 errors
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // Routes
  app.use('/', authRoutes);
  app.use('/', homeRoutes);
  app.use('/', pageRoutes);
  app.use('/predictions', predictionsRoutes);
  app.use('/matches', matchesRoutes);
  app.use('/admin', adminRoutes);
  app.use('/api/elo', eloRoutes);
  app.use('/api/simulation', simulationRoutes);
}

function createApp(options = {}) {
  const runtimeConfig = options.config || getConfig();
  const sessionSecret = getSessionSecret(options.sessionSecret, runtimeConfig);
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }

  const app = express();
  const assetVersion = options.assetVersion
    || runtimeConfig.assetVersion
    || Date.now().toString();
  app.locals.assetVersion = assetVersion;
  app.locals.assetPath = (assetUrl) => `${assetUrl}?v=${encodeURIComponent(assetVersion)}`;
  const sessionStore = options.sessionStore || createSessionStore();
  app.locals.databaseReplacementInProgress = false;
  app.locals.enterDatabaseReplacementMode = async () => {
    if (app.locals.databaseReplacementInProgress) {
      return;
    }

    app.locals.databaseReplacementInProgress = true;
    logger.warn('Entering maintenance mode for database replacement');
    eventSyncService.stop();
  };
  app.locals.exitDatabaseReplacementMode = () => {
    if (!app.locals.databaseReplacementInProgress) {
      return;
    }

    app.locals.databaseReplacementInProgress = false;
    logger.info('Exited maintenance mode for database replacement');
  };

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://api.squiggle.com.au", "https://cdn.jsdelivr.net"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-site' }
  }));

  // Configure view engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Middleware
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(methodOverride('_method'));

  app.use((req, res, next) => {
    if (!app.locals.databaseReplacementInProgress) {
      next();
      return;
    }

    if (req.path === '/healthz' || req.path === '/admin/upload-database') {
      next();
      return;
    }

    next(new AppError(
      'Database replacement in progress. Please retry shortly.',
      503,
      'SERVICE_UNAVAILABLE'
    ));
  });

  // Trust proxy for secure cookies behind reverse proxy
  app.set('trust proxy', 1);

  // Session configuration
  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: runtimeConfig.isProduction ? 'auto' : false,
      httpOnly: true,
      sameSite: 'lax'
    }
  }));

  // Make user data available to all templates
  app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.currentPath = req.path;
    next();
  });

  app.use(requestLogger);
  app.use(csrfProtection);

  registerAppRoutes(app);

  // Add global error handler (after routes)
  app.use(errorMiddleware);

  return app;
}

async function startServer(options = {}) {
  try {
    const runtimeConfig = options.config
      ? validateConfig(options.config)
      : getValidatedConfig();
    const app = createApp({ ...options, config: runtimeConfig });
    await initializeDatabase();
    await databaseHealthService.assertDatabaseHealthy({ context: 'startup' });
    await adminScriptRunner.recoverInterruptedRuns();
    await resultUpdateService.recoverInterruptedJobs();
    resultUpdateService.scheduleWorker();
    await eventSyncService.start();

    const port = options.port ?? runtimeConfig.port;
    app.listen(port, '0.0.0.0', () => {
      logger.info(`Server running on http://0.0.0.0:${port}`);
    });
  } catch (error) {
    logger.error('Failed to initialize database during startup', { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  let runtimeConfig;
  try {
    runtimeConfig = getValidatedConfig();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }

  const sessionSecret = getSessionSecret(undefined, runtimeConfig);
  if (!sessionSecret) {
    console.error('ERROR: SESSION_SECRET environment variable is required');
    process.exit(1);
  }

  startServer({ config: runtimeConfig, sessionSecret });
}

module.exports = {
  createApp,
  createSessionStore,
  startServer
};
