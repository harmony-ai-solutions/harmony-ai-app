/**
 * appVariant — unit tests (plan 7-14 V1).
 *
 * The variant is a build-time value; the test seam
 * ({@link setAppVariantForTests}) simulates a store build without a rebuild.
 */

import Config from 'react-native-config';
import {
  getAppVariant,
  isFullVariant,
  isStoreVariant,
  setAppVariantForTests,
} from '../appVariant';

const mockedConfig = Config as unknown as { APP_VARIANT?: string };

describe('appVariant (7-14)', () => {
  afterEach(() => {
    setAppVariantForTests(null);
    mockedConfig.APP_VARIANT = 'full';
  });

  it('resolves the build-time value (jest.setup mocks APP_VARIANT=full)', () => {
    setAppVariantForTests(null);
    expect(getAppVariant()).toBe('full');
    expect(isFullVariant()).toBe(true);
    expect(isStoreVariant()).toBe(false);
  });

  it('resolves store from the build-time value', () => {
    setAppVariantForTests(null);
    mockedConfig.APP_VARIANT = 'store';
    expect(getAppVariant()).toBe('store');
    expect(isStoreVariant()).toBe(true);
    expect(isFullVariant()).toBe(false);
  });

  it('is case-insensitive on the build-time value', () => {
    setAppVariantForTests(null);
    mockedConfig.APP_VARIANT = 'STORE';
    expect(getAppVariant()).toBe('store');
  });

  it('treats an absent / unknown value as full (design rule 6: self-built = full)', () => {
    setAppVariantForTests(null);
    mockedConfig.APP_VARIANT = undefined;
    expect(getAppVariant()).toBe('full');
    mockedConfig.APP_VARIANT = 'nonsense';
    expect(getAppVariant()).toBe('full');
    mockedConfig.APP_VARIANT = '';
    expect(getAppVariant()).toBe('full');
  });

  it('honors the test seam and restores the build-time value on null', () => {
    setAppVariantForTests('store');
    expect(getAppVariant()).toBe('store');
    expect(isStoreVariant()).toBe(true);

    setAppVariantForTests('full');
    expect(getAppVariant()).toBe('full');
    expect(isFullVariant()).toBe(true);

    // Override wins over the (store) build-time value until cleared.
    mockedConfig.APP_VARIANT = 'store';
    setAppVariantForTests('full');
    expect(getAppVariant()).toBe('full');
    setAppVariantForTests(null);
    expect(getAppVariant()).toBe('store');
  });
});
