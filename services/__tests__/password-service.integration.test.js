const path = require('path');

describe('password-service configured common password list', () => {
  test('loads the tracked common-password list for the singleton service', () => {
    const passwordService = require('../password-service');
    const expectedPath = path.join(__dirname, '../../data/config/common-passwords.txt');

    expect(passwordService.commonPasswordsFilePath).toBe(expectedPath);
    expect(passwordService.commonPasswords.size).toBeGreaterThan(0);
    expect(passwordService.isCommonPassword('password')).toBe(true);
  });
});
