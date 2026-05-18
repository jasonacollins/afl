const roundViewService = require('../round-view-service');

describe('round-view-service', () => {
  test('adds completion status and current round for display rounds', () => {
    const displayRounds = roundViewService.buildDisplayRounds(
      [{ round_number: '1' }, { round_number: '2' }],
      [
        { round_number: '1', hscore: 80, ascore: 70 },
        { round_number: '2', hscore: null, ascore: null }
      ],
      2026
    );

    expect(displayRounds).toEqual([
      { round_number: '1', source_round_numbers: ['1'], isCompleted: true },
      { round_number: '2', source_round_numbers: ['2'], isCompleted: false }
    ]);
    expect(roundViewService.getCurrentRound(displayRounds)).toBe('2');
  });

  test('selects the earliest upcoming unplayed match before completed fallback', () => {
    const selectedRound = roundViewService.selectDefaultRound(
      [
        {
          round_number: '1',
          match_date: '2026-03-10T08:00:00.000Z',
          hscore: 90,
          ascore: 80
        },
        {
          round_number: '3',
          match_date: '2026-03-25T08:00:00.000Z',
          hscore: null,
          ascore: null
        },
        {
          round_number: '2',
          match_date: '2026-03-20T08:00:00.000Z',
          hscore: null,
          ascore: null
        }
      ],
      [{ round_number: '1' }, { round_number: '2' }, { round_number: '3' }],
      2026,
      { now: new Date('2026-03-15T00:00:00.000Z') }
    );

    expect(selectedRound).toBe('2');
  });

  test('falls back to the most recent completed match then first round', () => {
    const completedRound = roundViewService.selectDefaultRound(
      [
        {
          round_number: '1',
          match_date: '2026-03-10T08:00:00.000Z',
          hscore: 90,
          ascore: 80
        },
        {
          round_number: '3',
          match_date: '2026-03-25T08:00:00.000Z',
          hscore: 70,
          ascore: 80
        }
      ],
      [{ round_number: '1' }, { round_number: '2' }, { round_number: '3' }],
      2026,
      { now: new Date('2026-04-01T00:00:00.000Z') }
    );
    const firstRound = roundViewService.selectDefaultRound(
      [],
      [{ round_number: 'OR' }],
      2026
    );

    expect(completedRound).toBe('3');
    expect(firstRound).toBe('OR');
  });
});
