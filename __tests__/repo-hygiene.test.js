const { execFileSync } = require('child_process');

describe('repository hygiene', () => {
  test('does not track runtime-generated data artifacts', () => {
    const trackedFiles = execFileSync('git', ['ls-files'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean);

    const generatedArtifactPatterns = [
      /^coverage\//,
      /^logs\//,
      /^data\/temp\//,
      /^data\/cache\//,
      /^scripts\/data\/cache\//,
      /^data\/database\/.*\.db(?:-wal|-shm)?$/,
      /^data\/simulations\/.*\.json$/,
      /^data\/predictions\/.*\.(?:csv|json)$/,
      /^data\/historical\//
    ];

    const offenders = trackedFiles.filter((filePath) =>
      generatedArtifactPatterns.some((pattern) => pattern.test(filePath))
    );

    expect(offenders).toEqual([]);
  });
});
