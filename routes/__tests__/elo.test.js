jest.mock('../../services/elo-service', () => ({
  getEloRatingsForYearRange: jest.fn(),
  getEloRatingsForYear: jest.fn(),
  getAvailableYears: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const request = require('supertest');
const eloService = require('../../services/elo-service');
const eloRouter = require('../elo');
const { createRouterTestApp } = require('./test-app');

describe('elo routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /ratings/range requires both years', async () => {
    const app = createRouterTestApp(eloRouter);

    const response = await request(app).get('/ratings/range?startYear=2024');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Both startYear and endYear query parameters are required.');
  });

  test('GET /ratings/range validates numeric year values', async () => {
    const app = createRouterTestApp(eloRouter);

    const response = await request(app).get('/ratings/range?startYear=abc&endYear=2025');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid year values. Must be valid 4-digit years.');
  });

  test('GET /ratings/range validates ordered years', async () => {
    const app = createRouterTestApp(eloRouter);

    const response = await request(app).get('/ratings/range?startYear=2026&endYear=2025');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Start year must be before or equal to end year.');
  });

  test('GET /ratings/range validates year bounds', async () => {
    const app = createRouterTestApp(eloRouter);

    const response = await request(app).get('/ratings/range?startYear=1999&endYear=2025');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Years must be between 2000');
  });

  test('GET /ratings/range returns elo data for a valid range', async () => {
    eloService.getEloRatingsForYearRange.mockResolvedValue({
      data: [{ round: 1 }],
      teams: ['Cats'],
      yearRange: [2024, 2025]
    });

    const app = createRouterTestApp(eloRouter);
    const response = await request(app).get('/ratings/range?startYear=2024&endYear=2025');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.startYear).toBe(2024);
    expect(response.body.endYear).toBe(2025);
    expect(response.body.data).toEqual([{ round: 1 }]);
    expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers.expires).toBe('0');
  });

  test('GET /ratings/:year returns a server error when the service fails', async () => {
    eloService.getEloRatingsForYear.mockRejectedValue(new Error('failed'));

    const app = createRouterTestApp(eloRouter);
    const response = await request(app).get('/ratings/2025');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Failed to retrieve ELO ratings data',
      year: 2025
    });
  });

  test('GET /ratings/:year validates invalid year parameters', async () => {
    const app = createRouterTestApp(eloRouter);

    const response = await request(app).get('/ratings/not-a-year');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid year parameter.');
  });

  test('GET /ratings/:year returns data and cache headers for valid requests', async () => {
    eloService.getEloRatingsForYear.mockResolvedValue({
      data: [{ round: 'Season start' }],
      teams: ['Cats'],
      yearRange: [2025, 2025]
    });

    const app = createRouterTestApp(eloRouter);
    const response = await request(app).get('/ratings/2025');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      year: 2025,
      data: [{ round: 'Season start' }],
      teams: ['Cats'],
      yearRange: [2025, 2025]
    });
    expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers.expires).toBe('0');
  });

  test('GET /years returns available years', async () => {
    eloService.getAvailableYears.mockResolvedValue([2026, 2025]);

    const app = createRouterTestApp(eloRouter);
    const response = await request(app).get('/years');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      years: [2026, 2025],
      count: 2
    });
    expect(response.headers['cache-control']).toBe('public, max-age=7200');
  });

  test('GET /years returns a server error when the service fails', async () => {
    eloService.getAvailableYears.mockRejectedValue(new Error('unavailable'));

    const app = createRouterTestApp(eloRouter);
    const response = await request(app).get('/years');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Failed to retrieve available years'
    });
  });
});
