jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn()
  }
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
const fs = require('fs').promises;
const simulationRouter = require('../simulation');
const { createRouterTestApp } = require('./test-app');

describe('simulation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /years returns an empty list when the simulation directory does not exist', async () => {
    fs.access.mockRejectedValueOnce(new Error('missing'));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/years');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      years: [],
      count: 0
    });
  });

  test('GET /years extracts unique years from simulation files', async () => {
    fs.access.mockResolvedValue();
    fs.readdir.mockResolvedValue([
      'season_simulation_2026.json',
      'season_simulation_2025_from_scratch.json',
      'season_simulation_2026_from_scratch.json',
      'ignore.txt'
    ]);

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/years');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      years: [2026, 2025],
      count: 2
    });
  });

  test('GET /years returns 500 when the simulation directory cannot be read', async () => {
    fs.access.mockResolvedValue();
    fs.readdir.mockRejectedValue(new Error('read directory failed'));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/years');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Failed to retrieve available simulation years'
    });
  });

  test('GET /export requires admin access', async () => {
    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/export?year=2026');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: 'Admin access required'
    });
  });

  test('GET /export validates the year query parameter', async () => {
    const app = createRouterTestApp(simulationRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });
    const response = await request(app).get('/export?year=2019');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'Invalid year parameter. Must be a valid year between 2020 and current year + 5.'
    });
  });

  test('GET /export downloads the simulation file for admins', async () => {
    fs.access.mockResolvedValue();

    const app = createRouterTestApp(simulationRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });
    app.response.download = function download(filePath, filename, callback) {
      this.json({ downloadedPath: filePath, filename });
      if (typeof callback === 'function') {
        callback(null);
      }
    };

    const response = await request(app).get('/export?year=2026');

    expect(response.status).toBe(200);
    expect(response.body.filename).toBe('season_simulation_2026.json');
    expect(response.body.downloadedPath).toContain('season_simulation_2026.json');
  });

  test('GET /export returns 404 when no simulation file exists', async () => {
    fs.access
      .mockRejectedValueOnce(new Error('missing standard'))
      .mockRejectedValueOnce(new Error('missing from scratch'));

    const app = createRouterTestApp(simulationRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });
    const response = await request(app).get('/export?year=2026');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: 'No simulation data available for year 2026',
      year: 2026
    });
  });

  test('GET /export logs download callback errors without failing the response', async () => {
    fs.access.mockResolvedValue();

    const app = createRouterTestApp(simulationRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });
    app.response.download = function download(filePath, filename, callback) {
      this.json({ downloadedPath: filePath, filename });
      if (typeof callback === 'function') {
        callback(new Error('stream failed'));
      }
    };

    const response = await request(app).get('/export?year=2026');

    expect(response.status).toBe(200);
    expect(response.body.filename).toBe('season_simulation_2026.json');
  });

  test('GET /:year validates the year parameter', async () => {
    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2019');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test('GET /:year returns 404 when no simulation file exists', async () => {
    fs.access
      .mockRejectedValueOnce(new Error('missing standard'))
      .mockRejectedValueOnce(new Error('missing from scratch'));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: 'No simulation data available for year 2026',
      year: 2026
    });
  });

  test('GET /:year returns parsed simulation data', async () => {
    fs.access.mockResolvedValue();
    fs.readFile.mockResolvedValue(JSON.stringify({
      year: 2026,
      num_simulations: 50000,
      completed_matches: 10,
      remaining_matches: 3,
      results: [{ team: 'Cats', ladder_position_probabilities: [0.2] }]
    }));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.year).toBe(2026);
    expect(response.body.num_simulations).toBe(50000);
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.headers['content-type']).toContain('application/json');
  });

  test('GET /:year falls back to the from-scratch file variant when the standard file is missing', async () => {
    fs.access
      .mockRejectedValueOnce(new Error('missing standard'))
      .mockResolvedValueOnce();
    fs.readFile.mockResolvedValue(JSON.stringify({
      year: 2026,
      num_simulations: 50000,
      completed_matches: 10,
      remaining_matches: 3,
      results: [{ team: 'Cats' }]
    }));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026');

    expect(response.status).toBe(200);
    expect(fs.readFile).toHaveBeenCalledWith(
      expect.stringContaining('season_simulation_2026_from_scratch.json'),
      'utf-8'
    );
  });

  test('GET /:year returns 500 when the simulation file contains invalid JSON', async () => {
    fs.access.mockResolvedValue();
    fs.readFile.mockResolvedValue('{invalid json');

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Failed to retrieve simulation data',
      year: 2026
    });
  });

  test('GET /:year/summary falls back to the from-scratch file variant', async () => {
    fs.access
      .mockRejectedValueOnce(new Error('missing standard'))
      .mockResolvedValueOnce();
    fs.readFile.mockResolvedValue(JSON.stringify({
      year: 2026,
      num_simulations: 50000,
      completed_matches: 10,
      remaining_matches: 3,
      last_updated: '2026-04-03T00:00:00.000Z',
      results: [{ team: 'Cats', premiership_probability: 0.2, finals_probability: 0.8 }]
    }));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026/summary');

    expect(response.status).toBe(200);
    expect(fs.readFile).toHaveBeenCalledWith(
      expect.stringContaining('season_simulation_2026_from_scratch.json'),
      'utf-8'
    );
  });

  test('GET /:year/summary returns summarized simulation output', async () => {
    fs.access.mockResolvedValue();
    fs.readFile.mockResolvedValue(JSON.stringify({
      year: 2026,
      num_simulations: 50000,
      completed_matches: 10,
      remaining_matches: 3,
      last_updated: '2026-04-03T00:00:00.000Z',
      current_round_label: 'Round 4',
      results: [
        {
          team: 'Cats',
          premiership_probability: 0.2,
          finals_probability: 0.8
        },
        {
          team: 'Lions',
          premiership_probability: 0.18,
          finals_probability: 0.77
        }
      ]
    }));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026/summary');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.top_5_premiership_contenders).toHaveLength(2);
    expect(response.body.current_round_label).toBe('Round 4');
  });

  test('GET /:year/summary validates the year parameter', async () => {
    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2019/summary');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'Invalid year parameter'
    });
  });

  test('GET /:year/summary returns 404 when no simulation file exists', async () => {
    fs.access
      .mockRejectedValueOnce(new Error('missing standard'))
      .mockRejectedValueOnce(new Error('missing from scratch'));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026/summary');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: 'No simulation data available for year 2026',
      year: 2026
    });
  });

  test('GET /:year/summary returns 500 when the summary file cannot be read', async () => {
    fs.access.mockResolvedValue();
    fs.readFile.mockRejectedValue(new Error('read failed'));

    const app = createRouterTestApp(simulationRouter);
    const response = await request(app).get('/2026/summary');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Failed to retrieve simulation summary',
      year: 2026
    });
  });
});
