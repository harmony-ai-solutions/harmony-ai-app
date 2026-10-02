/**
 * CloudPurgeBanner — global "your cloud data is being deleted" notice.
 *
 * Mounted ONCE near the navigation root (AppNavigator) so a running cloud
 * data purge is visible from ANY screen — not just SyncSettings. The banner
 * OBSERVES `cloudSessionService` events only:
 *   - visible while the purge is in flight (status 'purging' — initiating,
 *     polling, AND the deadline sub-state, where connecting stays paused);
 *   - hidden by the legacy status event on settle ('idle') and by
 *     'purge:terminal' for deleted/failed.
 *
 * ⚠️ Read-only-second-React-Root caveat (see SyncConnectionContext.tsx
 * "Read-only mode" comment): this banner must NEVER drive connection
 * lifecycle — no connect(), no disconnect(), no purgeCloudData(). It is a
 * passive observer + a navigation shortcut (tap → SyncSettings, where the
 * stateful purge card lives).
 *
 * The banner intentionally carries the message INSTEAD of connection-error
 * toasts: WebSockets dropping during the purge's kill phase are EXPECTED
 * (the session is gone by design), so SyncConnectionContext suppresses the
 * reconnect scheduling and the connection-lost toast while a purge blocks.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedCard } from '../themed/ThemedCard';
import {
  cloudSessionService,
  type CloudSessionStatus,
  type PurgeTerminalPayload,
} from '../../services/cloud/CloudSessionService';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export const CloudPurgeBanner: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('syncSettings');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  // Initial visibility from the singleton snapshot covers a purge adopted
  // before this component mounted (cold-start attach in SyncConnectionContext).
  const [visible, setVisible] = useState(cloudSessionService.isPurging());

  // Slide-down + fade on entry; reverse when hidden. Keep the node mounted
  // during the exit animation so it doesn't pop out of the tree.
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      easing: visible ? Easing.out(Easing.ease) : Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  useEffect(() => {
    const onStatus = (s: CloudSessionStatus) => {
      setVisible(s === 'purging');
    };
    const onTerminal = (payload: PurgeTerminalPayload) => {
      // deadline keeps the banner up — connecting is still paused.
      setVisible(payload.outcome === 'deadline');
    };
    const onCleared = () => {
      // A deadline-latched run was reconciled away (server reports none) —
      // nothing is being deleted; hiding is required, not optional.
      setVisible(false);
    };
    const onProgress = () => setVisible(true);
    cloudSessionService.on('status', onStatus);
    cloudSessionService.on('purge:terminal', onTerminal);
    cloudSessionService.on('purge:cleared', onCleared);
    cloudSessionService.on('purge:progress', onProgress);
    return () => {
      cloudSessionService.off('status', onStatus);
      cloudSessionService.off('purge:terminal', onTerminal);
      cloudSessionService.off('purge:cleared', onCleared);
      cloudSessionService.off('purge:progress', onProgress);
    };
  }, []);

  if (!theme) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 0],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { top: (insets?.top ?? 0) + 8, opacity, transform: [{ translateY }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigation.navigate('SyncSettings')}
        accessibilityRole="button"
        accessibilityLabel={t('purgeBannerTitle')}
        testID="cloud-purge-banner"
      >
        <ThemedCard style={styles.card}>
          <View style={styles.row}>
            <Icon
              name="cloud-remove-outline"
              size={22}
              color={theme.colors.status.error}
              style={styles.icon}
            />
            <View style={styles.textBlock}>
              <ThemedText weight="medium" size={14}>
                {t('purgeBannerTitle')}
              </ThemedText>
              <ThemedText variant="secondary" size={12}>
                {t('purgeBannerBody')}
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
          </View>
        </ThemedCard>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    // Anchored just under the OS safe-area top (set via the insets inline
    // above) so the blocking notice NEVER covers interactive content — the
    // previous bottom anchoring overlapped the "Sync Now" button and the
    // sync-confirmation-limit row on Data Synchronization. zIndex keeps it
    // above screens (siblings of the navigator stack on top); below
    // modals/alerts.
    zIndex: 10,
    elevation: 10,
  },
  card: {
    padding: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
});

export default CloudPurgeBanner;
