/**
 * AccountSettingsScreen — settings sub-menu for account, security and billing.
 *
 * Consolidates the rows that previously lived on the main Settings screen
 * (Account & Security + Billing & Purchases) into a single dedicated screen,
 * keeping the top-level Settings tab compact.
 *
 * ── STATE-AWARE (owner-approved 2026-10-17) ───────────────────────────────
 * The screen is no longer blind to auth state. A new first card is the
 * identity / status header:
 *   - signed in  → avatar initial, name, email, green "Signed in" dot, the
 *                  "This device · <name>" row, an optional device-authorization
 *                  warning, and the Log out action (same confirm Alert).
 *   - signed out → a value prop + a "Sign in with Soulbits" CTA that starts the
 *                  portal connect-session flow (mirrors LoginScreen).
 *   - pending    → an inline spinner ("Finish signing in in your browser")
 *                  instead of a second entry point.
 *   - loading    → a skeleton placeholder (no flash of the wrong state).
 *
 * Cloud-only rows (reset password, active sessions, delete account, billing)
 * are rendered only when signed in; the local rows (biometric lock, disabled
 * AIs, blocked users, my library) stay visible. Reset password keeps its
 * existing ComingSoon navigation — owner deferred the feature decision, so it
 * is NOT wired to the portal.
 *
 * Store variant (plan 7-14): purchases are disabled at launch, so the whole
 * "Billing & Purchases" card is hidden (Account & Security stays).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Alert, View, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { SettingsLinkRow } from '../../components/settings/SettingsRows';
import { isStoreVariant } from '../../config/appVariant';
import DeviceAuthService from '../../services/cloud/DeviceAuthService';
import { getDeviceDisplayName } from '../../services/cloud/deviceName';

export const AccountSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');
  const { user, status, pendingSignIn, signInViaPortal, logout } = useAuth();

  // Device-authorization indicator state. `null` = unknown → hidden; the
  // indicator only ever renders on an explicit `false`.
  const [deviceAuthorized, setDeviceAuthorized] = useState<boolean | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const isAuthed = status === 'authenticated';
  const isPending = pendingSignIn !== null && pendingSignIn.status === 'pending';

  // The human device name shown in "This device · <name>" — the SAME
  // derivation the connect-session flow announces to the cloud.
  useEffect(() => {
    let cancelled = false;
    getDeviceDisplayName()
      .then((name) => {
        if (!cancelled) setDeviceName(name);
      })
      .catch(() => {
        // non-critical — the row falls back to a placeholder
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Device-authorization indicator — D-DEV-01's still-orphaned getStatus()
  // (first consumer). Refetched on focus and whenever auth state changes.
  // A fetch failure hides the indicator (non-critical) rather than alarming
  // the user; only an explicit `authorized === false` surfaces the warning.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'authenticated') {
        setDeviceAuthorized(null);
        return undefined;
      }
      let cancelled = false;
      DeviceAuthService.getStatus()
        .then((s) => {
          if (!cancelled) setDeviceAuthorized(s.authorized);
        })
        .catch(() => {
          if (!cancelled) setDeviceAuthorized(null);
        });
      return () => {
        cancelled = true;
      };
    }, [status]),
  );

  /** Log out — confirmed via alert (accidental taps shouldn't dump the
   * session; signing back in is a full portal round-trip now). AuthGate
   * watches `status` and swaps to the sign-in wall when it flips. */
  const confirmLogout = () => {
    Alert.alert(t('logout'), t('logoutConfirmMessage'), [
      { text: t('logoutCancelAction'), style: 'cancel' },
      { text: t('logoutConfirmAction'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  /** Start the portal connect-session sign-in and push the waiting screen —
   * exactly the LoginScreen pattern (replace, so back returns to Settings). */
  const startPortalSignIn = useCallback(() => {
    void signInViaPortal();
    navigation.replace('PendingApproval');
  }, [signInViaPortal, navigation]);

  if (!theme) return null;

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

  // ── Identity card ─────────────────────────────────────────────────────
  const displayName = user?.display_name?.trim() || user?.email || '';
  const email = user?.email ?? '';
  const initial = (displayName[0] || email[0] || '?').toUpperCase();

  const renderIdentity = () => {
    // Bootstrap — a skeleton placeholder so there is no flash of the wrong
    // (signed-out or signed-in) state while the token/profile load resolves.
    if (status === 'loading') {
      return (
        <View
          style={styles.skeletonRow}
          testID="account-identity-skeleton"
          accessibilityLabel={t('identitySkeletonLabel')}
        >
          <View style={[styles.skeletonAvatar, { backgroundColor: theme.colors.text.muted }]} />
          <View style={styles.skeletonLines}>
            <View style={[styles.skeletonLineWide, { backgroundColor: theme.colors.text.muted }]} />
            <View style={[styles.skeletonLineNarrow, { backgroundColor: theme.colors.text.muted }]} />
          </View>
        </View>
      );
    }

    if (isAuthed) {
      return (
        <View style={styles.identityContent}>
          <View style={styles.identityRow} testID="account-identity">
            <View style={[styles.avatarCircle, { backgroundColor: theme.colors.accent.primary }]}>
              <ThemedText weight="bold" size={20} style={styles.avatarInitial}>
                {initial}
              </ThemedText>
            </View>
            <View style={styles.identityText}>
              <View style={styles.nameRow}>
                <ThemedText weight="bold" size={17} numberOfLines={1} style={styles.nameText}>
                  {displayName}
                </ThemedText>
                <View style={[styles.statusDot, { backgroundColor: theme.colors.status.success }]} />
                <ThemedText variant="success" weight="medium" size={12}>
                  {t('identitySignedIn')}
                </ThemedText>
              </View>
              <ThemedText variant="secondary" size={13} numberOfLines={1}>
                {email}
              </ThemedText>
            </View>
          </View>

          <ThemedText
            variant="muted"
            size={13}
            style={styles.deviceRow}
            testID="account-device-row"
          >
            {t('identityDeviceRow', { name: deviceName ?? '…' })}
          </ThemedText>

          {deviceAuthorized === false ? (
            <View style={styles.warningBlock} testID="account-device-auth-warning">
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('deviceAuthWarning')}
              </ThemedText>
              <ThemedButton
                label={t('deviceAuthReauthorize')}
                onPress={startPortalSignIn}
                variant="outline"
                style={styles.warningButton}
                testID="account-reauthorize"
              />
            </View>
          ) : null}

          <SettingsLinkRow
            icon="logout"
            label={t('logout')}
            onPress={confirmLogout}
            theme={theme}
            showSeparator
          />
        </View>
      );
    }

    // Pending portal sign-in — inline spinner, not a second entry point.
    if (isPending) {
      return (
        <View style={styles.pendingRow} testID="account-pending">
          <ActivityIndicator size="small" color={theme.colors.accent.primary} />
          <ThemedText variant="secondary" size={14}>
            {t('identityPending')}
          </ThemedText>
        </View>
      );
    }

    // Signed out.
    return (
      <View style={styles.signedOutBlock} testID="account-signed-out">
        <ThemedText variant="secondary" size={14} style={styles.valueProp}>
          {t('identitySignedOutValueProp')}
        </ThemedText>
        <ThemedButton
          label={t('identitySignInCta')}
          onPress={startPortalSignIn}
          testID="account-sign-in"
        />
      </View>
    );
  };

  // ── Account & Security rows — gated by auth state ─────────────────────
  // Cloud-account rows render only when signed in; local rows always render.
  // Separators are index-based so they stay correct as rows appear/disappear.
  const securityRows: Array<{
    key: string;
    icon: string;
    label: string;
    onPress: () => void;
  }> = [
    {
      key: 'biometricLock',
      icon: 'fingerprint',
      label: t('biometricLock'),
      onPress: () => navigation.navigate('BiometricLockSettings'),
    },
    ...(isAuthed
      ? [
          {
            key: 'resetPassword',
            icon: 'lock-reset',
            label: t('resetPassword'),
            // Unchanged — ComingSoon (owner deferred the feature decision).
            onPress: () =>
              navigateToComingSoon('resetPassword', 'lock-reset', 'comingSoonResetPassword'),
          },
          {
            key: 'activeSessions',
            icon: 'devices',
            label: t('activeSessions'),
            onPress: () =>
              navigateToComingSoon('activeSessions', 'devices', 'comingSoonActiveSessions'),
          },
          {
            key: 'deleteAccount',
            icon: 'delete-forever',
            label: t('deleteAccount'),
            onPress: () =>
              navigateToComingSoon('deleteAccount', 'delete-forever', 'comingSoonDeleteAccount'),
          },
        ]
      : []),
    {
      key: 'disabledAIs',
      icon: 'account-cancel',
      label: t('disabledAIsTitle'),
      onPress: () => navigation.navigate('DisabledAIs'),
    },
    {
      key: 'blockedUsers',
      icon: 'account-remove-outline',
      label: t('blockedUsersTitle'),
      onPress: () => navigation.navigate('BlockedUsers'),
    },
    {
      key: 'marketLibrary',
      icon: 'bookmark-outline',
      label: t('marketLibraryTitle'),
      onPress: () => navigation.navigate('MyLibrary'),
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('account')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity / status ── */}
        <ThemedCard elevated accentStripe style={styles.card} testID="account-identity-card">
          {renderIdentity()}
        </ThemedCard>

        {/* ── Account & Security ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('security')} style={styles.sectionHeader} />
          {securityRows.map((row, index) => (
            <SettingsLinkRow
              key={row.key}
              icon={row.icon}
              label={row.label}
              onPress={row.onPress}
              theme={theme}
              showSeparator={index > 0}
            />
          ))}
        </ThemedCard>

        {/* ── Billing & Purchases ── (signed-in only; store variant hides the
            whole surface — purchases are disabled at launch) */}
        {isAuthed && !isStoreVariant() ? (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('billing')} style={styles.sectionHeader} />
            <SettingsLinkRow
              icon="credit-card"
              label={t('manageSubscription')}
              onPress={() => navigateToComingSoon('manageSubscription', 'credit-card', 'comingSoonManageSubscription')}
              theme={theme}
            />
          </ThemedCard>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    gap: 12,
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeader: {
    marginTop: 0,
  },
  /* ── Identity card ─────────────────────────────────────────────────── */
  identityContent: {
    gap: 12,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    color: '#ffffff',
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameText: {
    flexShrink: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deviceRow: {
    paddingHorizontal: 16,
  },
  warningBlock: {
    gap: 10,
    paddingHorizontal: 16,
  },
  warningText: {
    lineHeight: 18,
  },
  warningButton: {
    height: 44,
  },
  /* ── Pending / signed-out / skeleton ───────────────────────────────── */
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  signedOutBlock: {
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  valueProp: {
    lineHeight: 20,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    opacity: 0.2,
  },
  skeletonLines: {
    flex: 1,
    gap: 8,
  },
  skeletonLineWide: {
    height: 14,
    borderRadius: 7,
    width: '55%',
    opacity: 0.2,
  },
  skeletonLineNarrow: {
    height: 12,
    borderRadius: 6,
    width: '35%',
    opacity: 0.2,
  },
});

export default AccountSettingsScreen;
