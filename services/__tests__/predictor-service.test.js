jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn()
}));

jest.mock('bcrypt', () => ({
  genSalt: jest.fn(),
  hash: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../password-service', () => ({
  validatePassword: jest.fn()
}));

const bcrypt = require('bcrypt');
const { getQuery, getOne, runQuery } = require('../../models/db');
const passwordService = require('../password-service');
const predictorService = require('../predictor-service');

describe('predictor-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    passwordService.validatePassword.mockReturnValue({ isValid: true, errors: [] });
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-password');
  });

  test('getAllPredictors returns predictors from the database', async () => {
    const predictors = [{ predictor_id: 1, name: 'dad' }];
    getQuery.mockResolvedValue(predictors);

    await expect(predictorService.getAllPredictors()).resolves.toEqual(predictors);
    expect(getQuery).toHaveBeenCalledWith(
      'SELECT predictor_id, name, display_name, is_admin, year_joined, active FROM predictors ORDER BY name'
    );
  });

  test('getAllPredictors converts database failures to AppError', async () => {
    getQuery.mockRejectedValue(new Error('db failed'));

    await expect(predictorService.getAllPredictors()).rejects.toMatchObject({
      message: 'Failed to fetch predictors',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('getActivePredictors returns active predictors from the database', async () => {
    const predictors = [{ predictor_id: 7, name: 'dad', active: 1 }];
    getQuery.mockResolvedValue(predictors);

    await expect(predictorService.getActivePredictors()).resolves.toEqual(predictors);
    expect(getQuery).toHaveBeenCalledWith(
      'SELECT predictor_id, name, display_name, is_admin, year_joined FROM predictors WHERE active = 1 ORDER BY name'
    );
  });

  test('getActivePredictors converts database failures to AppError', async () => {
    getQuery.mockRejectedValue(new Error('db failed'));

    await expect(predictorService.getActivePredictors()).rejects.toMatchObject({
      message: 'Failed to fetch active predictors',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('createPredictor rejects missing username or password', async () => {
    await expect(
      predictorService.createPredictor('', 'secret', 'Display Name', false, 2026)
    ).rejects.toMatchObject({
      message: 'Username and password are required',
      errorCode: 'VALIDATION_ERROR'
    });
  });

  test('createPredictor rejects missing display name', async () => {
    await expect(
      predictorService.createPredictor('dad', 'secret', '', false, 2026)
    ).rejects.toMatchObject({
      message: 'Display name is required',
      errorCode: 'VALIDATION_ERROR'
    });
  });

  test('createPredictor rejects invalid passwords from password-service', async () => {
    passwordService.validatePassword.mockReturnValue({
      isValid: false,
      errors: ['Password must be longer']
    });

    await expect(
      predictorService.createPredictor('dad', 'short', 'Display Name', false, 2026)
    ).rejects.toMatchObject({
      message: 'Password must be longer',
      errorCode: 'VALIDATION_ERROR'
    });
  });

  test('createPredictor hashes password and writes the predictor', async () => {
    await predictorService.createPredictor('dad', 'secret', 'Dad', true, 2026);

    expect(bcrypt.genSalt).toHaveBeenCalledWith(12);
    expect(bcrypt.hash).toHaveBeenCalledWith('secret', 'salt');
    expect(runQuery).toHaveBeenCalledWith(
      'INSERT INTO predictors (name, display_name, password, is_admin, year_joined) VALUES (?, ?, ?, ?, ?)',
      ['dad', 'Dad', 'hashed-password', 1, 2026]
    );
  });

  test('createPredictor falls back to the current year when yearJoined is omitted', async () => {
    const currentYear = new Date().getFullYear();

    await predictorService.createPredictor('dad', 'secret', 'Dad', false);

    expect(runQuery).toHaveBeenCalledWith(
      'INSERT INTO predictors (name, display_name, password, is_admin, year_joined) VALUES (?, ?, ?, ?, ?)',
      ['dad', 'Dad', 'hashed-password', 0, currentYear]
    );
  });

  test('createPredictor maps unique-constraint failures to validation errors', async () => {
    runQuery.mockRejectedValue(new Error('SQLITE_CONSTRAINT: UNIQUE failed: predictors.name'));

    await expect(
      predictorService.createPredictor('dad', 'secret', 'Dad', false, 2026)
    ).rejects.toMatchObject({
      message: 'Username already exists',
      errorCode: 'VALIDATION_ERROR'
    });
  });

  test('createPredictor maps hashing failures to AppError', async () => {
    bcrypt.genSalt.mockRejectedValue(new Error('bcrypt down'));

    await expect(
      predictorService.createPredictor('dad', 'secret', 'Dad', false, 2026)
    ).rejects.toMatchObject({
      message: 'Failed to create predictor',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('resetPassword rejects missing passwords', async () => {
    await expect(predictorService.resetPassword(4, '')).rejects.toMatchObject({
      message: 'New password is required',
      errorCode: 'VALIDATION_ERROR'
    });
  });

  test('resetPassword rejects invalid passwords', async () => {
    passwordService.validatePassword.mockReturnValue({
      isValid: false,
      errors: ['Password must include a number']
    });

    await expect(predictorService.resetPassword(4, 'abcdef')).rejects.toMatchObject({
      message: 'Password must include a number',
      errorCode: 'VALIDATION_ERROR'
    });
  });

  test('resetPassword raises not found when no predictor was updated', async () => {
    runQuery.mockResolvedValue({ changes: 0 });

    await expect(predictorService.resetPassword(77, 'secret123')).rejects.toMatchObject({
      message: 'Predictor not found',
      statusCode: 404,
      errorCode: 'NOT_FOUND'
    });
  });

  test('resetPassword hashes the password before updating', async () => {
    runQuery.mockResolvedValue({ changes: 1 });

    await predictorService.resetPassword(4, 'secret123');

    expect(runQuery).toHaveBeenCalledWith(
      'UPDATE predictors SET password = ? WHERE predictor_id = ?',
      ['hashed-password', 4]
    );
  });

  test('resetPassword maps unexpected failures to AppError', async () => {
    bcrypt.hash.mockRejectedValue(new Error('hash failed'));

    await expect(predictorService.resetPassword(4, 'secret123')).rejects.toMatchObject({
      message: 'Failed to reset password',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('deletePredictor deletes predictions before deleting the predictor', async () => {
    runQuery
      .mockResolvedValueOnce({ changes: 3 })
      .mockResolvedValueOnce({ changes: 1 });

    await predictorService.deletePredictor(8);

    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM predictions WHERE predictor_id = ?',
      [8]
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM predictors WHERE predictor_id = ?',
      [8]
    );
  });

  test('deletePredictor raises not found when the predictor row does not exist', async () => {
    runQuery
      .mockResolvedValueOnce({ changes: 0 })
      .mockResolvedValueOnce({ changes: 0 });

    await expect(predictorService.deletePredictor(8)).rejects.toMatchObject({
      message: 'Predictor not found',
      statusCode: 404,
      errorCode: 'NOT_FOUND'
    });
  });

  test('deletePredictor maps unexpected database failures to AppError', async () => {
    runQuery.mockRejectedValue(new Error('delete failed'));

    await expect(predictorService.deletePredictor(8)).rejects.toMatchObject({
      message: 'Failed to delete predictor',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('getPredictorById returns null when no row exists', async () => {
    getOne.mockResolvedValue(null);

    await expect(predictorService.getPredictorById(7)).resolves.toBeNull();
    expect(getOne).toHaveBeenCalledWith('SELECT * FROM predictors WHERE predictor_id = ?', [7]);
  });

  test('getPredictorById converts database failures to AppError', async () => {
    getOne.mockRejectedValue(new Error('db failed'));

    await expect(predictorService.getPredictorById(7)).rejects.toMatchObject({
      message: 'Failed to fetch predictor',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('getPredictorByName returns predictor rows by username', async () => {
    const predictor = { predictor_id: 3, name: 'dad' };
    getOne.mockResolvedValue(predictor);

    await expect(predictorService.getPredictorByName('dad')).resolves.toEqual(predictor);
    expect(getOne).toHaveBeenCalledWith('SELECT * FROM predictors WHERE name = ?', ['dad']);
  });

  test('getPredictorByName converts database failures to AppError', async () => {
    getOne.mockRejectedValue(new Error('db failed'));

    await expect(predictorService.getPredictorByName('dad')).rejects.toMatchObject({
      message: 'Failed to fetch predictor',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('getPredictorsWithAdminStatus returns predictors including flags', async () => {
    const predictors = [{ predictor_id: 2, stats_excluded: 1, active: 0 }];
    getQuery.mockResolvedValue(predictors);

    await expect(predictorService.getPredictorsWithAdminStatus()).resolves.toEqual(predictors);
    expect(getQuery).toHaveBeenCalledWith(
      'SELECT predictor_id, name, display_name, is_admin, stats_excluded, active FROM predictors ORDER BY name'
    );
  });

  test('getPredictorsWithAdminStatus converts database failures to AppError', async () => {
    getQuery.mockRejectedValue(new Error('db failed'));

    await expect(predictorService.getPredictorsWithAdminStatus()).rejects.toMatchObject({
      message: 'Failed to fetch predictors',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });
});
