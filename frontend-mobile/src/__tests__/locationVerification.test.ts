import { buildLocationEvidence, buildVerificationEvidence, isVerificationCurrent } from '@/utils/locationVerification';
import { describe, expect, test } from '@jest/globals';

describe('mobile GPS evidence', () => {
  test('maps a foreground Expo location without a verified flag', () => {
    const evidence = buildVerificationEvidence(
      { latitude: 10.775, longitude: 106.7, accuracy: 12 },
      1700000000000,
      'abcdefghij'
    );
    expect(evidence).toEqual({
      requestId: 'gps_1700000000000_abcdefghij',
      lat: 10.775,
      lng: 106.7,
      accuracy: 12,
      timestamp: '2023-11-14T22:13:20.000Z',
    });
    expect(evidence).not.toHaveProperty('verified');
  });

  test('rejects missing accuracy and invalid timestamps', () => {
    expect(() => buildLocationEvidence(
      { latitude: 10.775, longitude: 106.7, accuracy: null },
      Date.now()
    )).toThrow(/accuracy/);
    expect(() => buildLocationEvidence(
      { latitude: 10.775, longitude: 106.7, accuracy: 10 },
      Number.NaN
    )).toThrow(/timestamp/);
  });

  test('treats expired and invalid verification as blocked', () => {
    const now = Date.parse('2026-10-20T10:00:00.000Z');
    expect(isVerificationCurrent({ isValid: true, expiresAt: '2026-10-20T10:01:00.000Z' }, now)).toBe(true);
    expect(isVerificationCurrent({ isValid: true, expiresAt: '2026-10-20T09:59:59.000Z' }, now)).toBe(false);
    expect(isVerificationCurrent({ isValid: false, expiresAt: '2026-10-20T10:01:00.000Z' }, now)).toBe(false);
  });
});
