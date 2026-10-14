/**
 * appChannel — unit tests (plan 7-10; channel now DERIVED from APP_VARIANT in
 * plan 7-14 V1).
 *
 * jest.setup mocks Platform.OS='ios' globally. The default suite exercises the
 * variant-derived channel (platform-independent); the Android suite reloads the
 * module with a Platform mock to cover `isApkSelfUpdateAvailable`.
 */

import { getAppChannel, isApkSelfUpdateAvailable } from '../appChannel';
import { setAppVariantForTests } from '../appVariant';

describe('appChannel — derived from APP_VARIANT (7-14)', () => {
  afterEach(() => setAppVariantForTests(null));

  it('full variant → sideload', () => {
    setAppVariantForTests('full');
    expect(getAppChannel()).toBe('sideload');
  });

  it('store variant → play (the store listing owns updates)', () => {
    setAppVariantForTests('store');
    expect(getAppChannel()).toBe('play');
  });

  it('store variant never offers the APK self-update (any platform)', () => {
    setAppVariantForTests('store');
    expect(isApkSelfUpdateAvailable()).toBe(false);
  });
});

describe('isApkSelfUpdateAvailable — Android gating (7-10/7-14)', () => {
  afterEach(() => {
    setAppVariantForTests(null);
    jest.resetModules();
    jest.dontMock('react-native/Libraries/Utilities/Platform');
  });

  function loadForAndroidVariant(variant: 'store' | 'full') {
    jest.resetModules();
    jest.doMock('react-native/Libraries/Utilities/Platform', () => ({
      __esModule: true,
      default: {
        OS: 'android',
        select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
      },
    }));
    const variantModule = require('../appVariant') as typeof import('../appVariant');
    variantModule.setAppVariantForTests(variant);
    return require('../appChannel') as typeof import('../appChannel');
  }

  it('full variant on Android → available', () => {
    const channel = loadForAndroidVariant('full');
    expect(channel.getAppChannel()).toBe('sideload');
    expect(channel.isApkSelfUpdateAvailable()).toBe(true);
  });

  it('store variant on Android → NOT available', () => {
    const channel = loadForAndroidVariant('store');
    expect(channel.getAppChannel()).toBe('play');
    expect(channel.isApkSelfUpdateAvailable()).toBe(false);
  });
});
