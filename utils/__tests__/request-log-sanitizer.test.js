const {
  REDACTED_VALUE,
  sanitizeRequestMetadata,
  sanitizeValue
} = require('../request-log-sanitizer');

describe('request-log-sanitizer', () => {
  test('sanitizeValue redacts nested sensitive keys without mutating safe values', () => {
    const input = {
      username: 'member',
      password: 'secret',
      nested: {
        token: 'abc123',
        profile: {
          display_name: 'Member'
        }
      },
      entries: [
        { _csrf: 'csrf-token' },
        { score: 7 }
      ]
    };

    expect(sanitizeValue(input)).toEqual({
      username: 'member',
      password: REDACTED_VALUE,
      nested: {
        token: REDACTED_VALUE,
        profile: {
          display_name: 'Member'
        }
      },
      entries: [
        { _csrf: REDACTED_VALUE },
        { score: 7 }
      ]
    });
  });

  test('sanitizeRequestMetadata redacts headers and uses the session user id', () => {
    const metadata = sanitizeRequestMetadata({
      body: { newPassword: 'super-secret' },
      params: { predictorId: '7' },
      query: { search: 'cats' },
      headers: {
        authorization: 'Bearer token',
        cookie: 'connect.sid=session-cookie',
        'x-csrf-token': 'csrf-token'
      },
      ip: '203.0.113.9',
      session: {
        user: { id: 7 }
      }
    });

    expect(metadata).toEqual({
      body: { newPassword: REDACTED_VALUE },
      params: { predictorId: '7' },
      query: { search: 'cats' },
      headers: {
        authorization: REDACTED_VALUE,
        cookie: REDACTED_VALUE,
        'x-csrf-token': REDACTED_VALUE
      },
      ip: '203.0.113.9',
      user: 7
    });
  });
});
