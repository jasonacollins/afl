
// 1. Mock the 'fs' module. Jest will hoist this to the top.
jest.mock('fs');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// 2. Import the modules we need for testing.
const fs = require('fs'); // This will be the mocked version of fs.
const { PasswordService, loadCommonPasswordsFromFile } = require('../password-service');

// 3. The first describe block for the class itself. This doesn't use the mock.
describe('PasswordService', () => {
  let passwordService;

  test('should validate a strong, unique password', () => {
    passwordService = new PasswordService(new Set());
    const result = passwordService.validatePassword('aVeryStrongP@ssw0rd');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should invalidate a password that is too short', () => {
    passwordService = new PasswordService(new Set());
    const result = passwordService.validatePassword('short');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters long');
  });

  test('should invalidate a common password when it is in the list', () => {
    const commonPasswords = new Set(['thisisacommonpassword']);
    passwordService = new PasswordService(commonPasswords);
    const result = passwordService.validatePassword('thisisacommonpassword');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('This password is too common. Please choose a more unique password');
    expect(result.errors).toHaveLength(1);
  });

  test('should invalidate a password with an obvious pattern', () => {
    passwordService = new PasswordService(new Set());
    const result = passwordService.validatePassword('123456789012');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password contains obvious patterns. Please choose a stronger password');
  });

  test('should invalidate a password with multiple issues', () => {
    const commonPasswords = new Set(['password']);
    passwordService = new PasswordService(commonPasswords);
    const result = passwordService.validatePassword('password');
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors).toContain('Password must be at least 12 characters long');
    expect(result.errors).toContain('This password is too common. Please choose a more unique password');
    expect(result.errors).toContain('Password contains obvious patterns. Please choose a stronger password');
  });

  test('should handle an empty password', () => {
    passwordService = new PasswordService(new Set());
    const result = passwordService.validatePassword('');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters long');
  });

  test('should correctly identify a common password from the provided list', () => {
    const commonPasswords = new Set(['password', '123456', 'qwerty']);
    passwordService = new PasswordService(commonPasswords);
    expect(passwordService.isCommonPassword('password')).toBe(true);
    expect(passwordService.isCommonPassword('123456')).toBe(true);
    expect(passwordService.isCommonPassword('qwerty')).toBe(true);
    expect(passwordService.isCommonPassword('notacommonpassword')).toBe(false);
  });
});

// 4. The second describe block for the file loader function. This WILL use the mock.
describe('loadCommonPasswordsFromFile', () => {
  beforeEach(() => {
    fs.existsSync.mockClear();
    fs.readFileSync.mockClear();
  });

  test('should load and parse passwords from a file', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('pass1\npass2\npass3\n');

    const passwords = loadCommonPasswordsFromFile('fake/path.txt');

    expect(fs.existsSync).toHaveBeenCalledWith('fake/path.txt');
    expect(fs.readFileSync).toHaveBeenCalledWith('fake/path.txt', 'utf-8');
    expect(passwords.size).toBe(3);
    expect(passwords.has('pass1')).toBe(true);
  });

  test('should return an empty set if the file does not exist', () => {
    fs.existsSync.mockReturnValue(false);

    const passwords = loadCommonPasswordsFromFile('fake/path.txt');

    expect(fs.existsSync).toHaveBeenCalledWith('fake/path.txt');
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(passwords.size).toBe(0);
  });

  test('should return an empty set on file read error', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => {
      throw new Error('FS Read Error');
    });

    const passwords = loadCommonPasswordsFromFile('fake/path.txt');

    expect(fs.existsSync).toHaveBeenCalledWith('fake/path.txt');
    expect(fs.readFileSync).toHaveBeenCalledWith('fake/path.txt', 'utf-8');
    expect(passwords.size).toBe(0);
  });
});
