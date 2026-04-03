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
});
