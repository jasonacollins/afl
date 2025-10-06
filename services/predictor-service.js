// services/predictor-service.js
const { getQuery, getOne, runQuery } = require('../models/db');
const bcrypt = require('bcrypt');
const { AppError, createNotFoundError, createValidationError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const passwordService = require('./password-service');

// Get all predictors
async function getAllPredictors() {
  try {
    logger.debug('Fetching all predictors');

    const predictors = await getQuery(
      'SELECT predictor_id, name, display_name, is_admin, year_joined, active FROM predictors ORDER BY name'
    );

    logger.info(`Retrieved ${predictors.length} predictors`);

    return predictors;
  } catch (error) {
    logger.error('Error fetching all predictors', { error: error.message });
    throw new AppError('Failed to fetch predictors', 500, 'DATABASE_ERROR');
  }
}

// Get only active predictors
async function getActivePredictors() {
  try {
    logger.debug('Fetching active predictors');

    const predictors = await getQuery(
      'SELECT predictor_id, name, display_name, is_admin, year_joined FROM predictors WHERE active = 1 ORDER BY name'
    );

    logger.info(`Retrieved ${predictors.length} active predictors`);

    return predictors;
  } catch (error) {
    logger.error('Error fetching active predictors', { error: error.message });
    throw new AppError('Failed to fetch active predictors', 500, 'DATABASE_ERROR');
  }
}

// Get predictor by ID
async function getPredictorById(predictorId) {
  try {
    logger.debug(`Fetching predictor by ID: ${predictorId}`);
    
    const predictor = await getOne(
      'SELECT * FROM predictors WHERE predictor_id = ?',
      [predictorId]
    );
    
    if (!predictor) {
      logger.warn(`Predictor not found with ID: ${predictorId}`);
    }
    
    return predictor;
  } catch (error) {
    logger.error('Error fetching predictor by ID', { 
      predictorId,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictor', 500, 'DATABASE_ERROR');
  }
}

// Get predictor by name
async function getPredictorByName(name) {
  try {
    logger.debug(`Fetching predictor by name: ${name}`);
    
    const predictor = await getOne(
      'SELECT * FROM predictors WHERE name = ?',
      [name]
    );
    
    if (!predictor) {
      logger.debug(`Predictor not found with name: ${name}`);
    }
    
    return predictor;
  } catch (error) {
    logger.error('Error fetching predictor by name', { 
      name,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictor', 500, 'DATABASE_ERROR');
  }
}

// Create new predictor
async function createPredictor(username, password, displayName, isAdmin, yearJoined) {
  try {
    // Validate inputs
    if (!username || !password) {
      throw createValidationError('Username and password are required');
    }
    
    if (!displayName) {
      throw createValidationError('Display name is required');
    }
    
    // Validate password
    const passwordValidation = passwordService.validatePassword(password);
    if (!passwordValidation.isValid) {
      throw createValidationError(passwordValidation.errors.join('. '));
    }
    
    logger.info(`Creating new predictor: ${username}`);
    
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const isAdminValue = isAdmin ? 1 : 0;
    const yearJoinedValue = yearJoined || new Date().getFullYear();
    
    await runQuery(
      'INSERT INTO predictors (name, display_name, password, is_admin, year_joined) VALUES (?, ?, ?, ?, ?)',
      [username, displayName, hashedPassword, isAdminValue, yearJoinedValue]
    );
    
    logger.info(`Successfully created predictor: ${username} (display: ${displayName}, admin: ${isAdminValue}, year: ${yearJoinedValue})`);
  } catch (error) {
    if (error.isOperational) {
      throw error; // Re-throw validation errors
    }
    
    logger.error('Error creating predictor', { 
      username,
      displayName,
      isAdmin,
      yearJoined,
      error: error.message 
    });
    
    // Check if it's a unique constraint violation
    if (error.message.includes('UNIQUE')) {
      throw createValidationError('Username already exists');
    }
    
    throw new AppError('Failed to create predictor', 500, 'DATABASE_ERROR');
  }
}

// Reset password
async function resetPassword(predictorId, newPassword) {
  try {
    // Validate input
    if (!newPassword) {
      throw createValidationError('New password is required');
    }
    
    // Validate password
    const passwordValidation = passwordService.validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      throw createValidationError(passwordValidation.errors.join('. '));
    }
    
    logger.info(`Resetting password for predictor ID: ${predictorId}`);
    
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    const result = await runQuery(
      'UPDATE predictors SET password = ? WHERE predictor_id = ?',
      [hashedPassword, predictorId]
    );
    
    if (result.changes === 0) {
      logger.warn(`No predictor found with ID: ${predictorId} for password reset`);
      throw createNotFoundError('Predictor');
    }
    
    logger.info(`Successfully reset password for predictor ID: ${predictorId}`);
  } catch (error) {
    if (error.isOperational) {
      throw error; // Re-throw validation/not found errors
    }
    
    logger.error('Error resetting password', { 
      predictorId,
      error: error.message 
    });
    throw new AppError('Failed to reset password', 500, 'DATABASE_ERROR');
  }
}

// Delete predictor
async function deletePredictor(predictorId) {
  try {
    logger.info(`Deleting predictor ID: ${predictorId}`);
    
    // Delete predictions first (foreign key constraint)
    const predResult = await runQuery(
      'DELETE FROM predictions WHERE predictor_id = ?',
      [predictorId]
    );
    
    logger.info(`Deleted ${predResult.changes} predictions for predictor ID: ${predictorId}`);
    
    // Delete the predictor
    const predictorResult = await runQuery(
      'DELETE FROM predictors WHERE predictor_id = ?',
      [predictorId]
    );
    
    if (predictorResult.changes === 0) {
      logger.warn(`No predictor found with ID: ${predictorId} for deletion`);
      throw createNotFoundError('Predictor');
    }
    
    logger.info(`Successfully deleted predictor ID: ${predictorId}`);
  } catch (error) {
    if (error.isOperational) {
      throw error; // Re-throw not found errors
    }
    
    logger.error('Error deleting predictor', { 
      predictorId,
      error: error.message 
    });
    throw new AppError('Failed to delete predictor', 500, 'DATABASE_ERROR');
  }
}

async function getPredictorsWithAdminStatus() {
  try {
    logger.debug('Fetching predictors with admin status');

    const predictors = await getQuery(
      'SELECT predictor_id, name, display_name, is_admin, stats_excluded, active FROM predictors ORDER BY name'
    );

    logger.info(`Retrieved ${predictors.length} predictors with admin status`);

    return predictors;
  } catch (error) {
    logger.error('Error fetching predictors with admin status', { error: error.message });
    throw new AppError('Failed to fetch predictors', 500, 'DATABASE_ERROR');
  }
}

module.exports = {
  getAllPredictors,
  getActivePredictors,
  getPredictorById,
  getPredictorByName,
  createPredictor,
  resetPassword,
  deletePredictor,
  getPredictorsWithAdminStatus
};
