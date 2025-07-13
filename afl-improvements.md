# AFL Predictions - High Value Improvements

## Overview
This document outlines practical, high-value improvements for the AFL Predictions codebase based on the current architecture and needs. These improvements focus on delivering real value without unnecessary complexity.

## Priority 1: Testing Infrastructure ⭐⭐⭐

### Current State
- Jest is configured but test coverage is minimal
- Critical business logic (scoring algorithms) is untested
- No integration tests for API endpoints

### Recommended Improvements

#### 1. Test Critical Services First
Start with business-critical services that contain complex logic:

```javascript
// __tests__/services/scoring-service.test.js
describe('ScoringService', () => {
  describe('calculateBrierScore', () => {
    test('perfect prediction scores 0', () => {
      expect(calculateBrierScore(1.0, 1)).toBe(0);
    });
    
    test('worst prediction scores 2', () => {
      expect(calculateBrierScore(0.0, 1)).toBe(2);
    });
  });
  
  describe('calculateBitsScore', () => {
    // Test the logarithmic scoring logic
  });
});
```

#### 2. Test Order Priority
1. `scoring-service.js` - Core business logic
2. `prediction-service.js` - Data integrity critical
3. `match-service.js` - Match state management
4. API endpoints - Integration tests

### Benefits
- Catch bugs before production
- Safe refactoring
- Living documentation
- Confidence in changes

## Priority 2: Large Route File Refactoring ⭐⭐

### Current State
- `routes/admin.js` is 400+ lines
- Multiple responsibilities mixed together
- Hard to find specific functionality

### Recommended Structure

```
routes/
├── admin/
│   ├── index.js          # Main admin router
│   ├── users.js          # User management routes
│   ├── database.js       # Backup/restore routes
│   └── config.js         # App configuration routes
```

#### Implementation Example

```javascript
// routes/admin/index.js
const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../auth');

// Apply middleware to all admin routes
router.use(isAuthenticated);
router.use(isAdmin);

// Mount sub-routers
router.use('/users', require('./users'));
router.use('/database', require('./database'));
router.use('/config', require('./config'));

// Main admin dashboard
router.get('/', async (req, res) => {
  // Dashboard logic
});

module.exports = router;
```

### Benefits
- Easier navigation
- Clear separation of concerns
- Simpler testing
- Reduced merge conflicts

## Priority 3: Configuration Management ⭐⭐

### Current State
- Environment variables used but not validated
- No clear defaults
- Configuration scattered through codebase

### Recommended Implementation

```javascript
// config/index.js
const path = require('path');

// Helper to require environment variables
const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
};

// Helper for optional variables with defaults
const optional = (name, defaultValue) => {
  return process.env[name] || defaultValue;
};

module.exports = {
  // Server config
  port: optional('PORT', 3001),
  nodeEnv: optional('NODE_ENV', 'development'),
  
  // Security
  sessionSecret: required('SESSION_SECRET'),
  
  // Database
  database: {
    path: optional('DB_PATH', path.join(__dirname, '../data/database/afl_predictions.db')),
    backupDir: optional('BACKUP_DIR', path.join(__dirname, '../data/backups'))
  },
  
  // External APIs
  squiggle: {
    baseUrl: optional('SQUIGGLE_API_URL', 'https://api.squiggle.com.au'),
    timeout: parseInt(optional('SQUIGGLE_TIMEOUT', '30000'))
  },
  
  // Feature flags
  features: {
    eloChart: optional('FEATURE_ELO_CHART', 'true') === 'true'
  }
};
```

#### Usage
```javascript
// app.js
const config = require('./config');

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});
```

### Benefits
- Fail fast on misconfiguration
- Clear defaults
- Type conversion handled
- Central configuration source
- Easy to test different configs

## Priority 4: API Response Consistency ⭐

### Current State
- Mixed HTML and JSON responses
- Inconsistent error formats
- No standard response structure

### Recommended Standards

#### 1. Separate API Routes
```javascript
// routes/api/v1/predictions.js
router.get('/predictions/:userId', async (req, res) => {
  try {
    const predictions = await predictionService.getPredictionsForUser(userId);
    res.json({
      success: true,
      data: predictions
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: {
        message: error.message,
        code: error.errorCode
      }
    });
  }
});
```

#### 2. Consistent Response Wrapper
```javascript
// utils/api-response.js
const sendSuccess = (res, data, message = null) => {
  res.json({
    success: true,
    message,
    data
  });
};

const sendError = (res, error, statusCode = 500) => {
  res.status(statusCode).json({
    success: false,
    error: {
      message: error.message,
      code: error.errorCode || 'UNKNOWN_ERROR'
    }
  });
};

module.exports = { sendSuccess, sendError };
```

### Benefits
- Predictable frontend integration
- Easier error handling
- API versioning ready
- Clear separation of web vs API

## Implementation Strategy

### Phase 1: Foundation (Week 1-2)
1. Set up configuration management
2. Add tests for scoring-service
3. Create API response utilities

### Phase 2: Refactoring (Week 3-4)
1. Split admin routes
2. Standardise API responses
3. Add integration tests

### Phase 3: Expansion (Ongoing)
1. Increase test coverage
2. Add more configuration options
3. Document API endpoints

## Measuring Success

- **Test Coverage**: Aim for 70%+ on critical services
- **Route File Size**: No route file over 200 lines
- **API Consistency**: 100% of AJAX endpoints return JSON
- **Configuration**: Zero hardcoded values in code

## Notes

These improvements focus on:
- Practical benefits over theoretical purity
- Incremental changes that don't require rewrites
- Improvements that make daily development easier
- Changes that reduce bugs and improve reliability

The repository pattern and other architectural changes can wait until there's a clear need (database change, complex caching requirements, etc.).