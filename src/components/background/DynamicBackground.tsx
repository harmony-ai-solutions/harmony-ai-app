/**
 * DynamicBackground — Background Orchestrator Component
 *
 * Reads the active background style from ThemeContext and renders
 * the matching animated background along with the StardustParticles
 * overlay. The user can switch between 5 distinct background designs
 * from the Theme Settings screen:
 *
 *   - 'aurora'        → DynamicAtmosphericBackground (drifting nebula orbs)
 *   - 'geodesic'      → GeodesicBackground (rotating diamond crystals)
 *   - 'lightPillars'  → LightPillarsBackground (rising light beams)
 *   - 'constellation' → ConstellationBackground (star cluster groups)
 *   - 'gradientFlow'  → GradientFlowBackground (flowing gradient ribbons)
 *
 * When dynamic effects are disabled (dynamicBackgroundEnabled=false),
 * each background component renders its own static fallback.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { DynamicAtmosphericBackground } from './DynamicAtmosphericBackground';
import { GeodesicBackground } from './GeodesicBackground';
import { LightPillarsBackground } from './LightPillarsBackground';
import { ConstellationBackground } from './ConstellationBackground';
import { GradientFlowBackground } from './GradientFlowBackground';
import { StardustParticles } from './StardustParticles';

interface DynamicBackgroundProps {
  /** Show stardust particle overlay on top of the background */
  showParticles?: boolean;
}

export const DynamicBackground: React.FC<DynamicBackgroundProps> = React.memo(
  ({ showParticles = true }) => {
    const { dynamicBackgroundEnabled, backgroundStyle } = useAppTheme();

    const renderBackground = () => {
      const enabled = dynamicBackgroundEnabled;

      switch (backgroundStyle) {
        case 'aurora':
          return <DynamicAtmosphericBackground enabled={enabled} />;
        case 'geodesic':
          return <GeodesicBackground enabled={enabled} />;
        case 'lightPillars':
          return <LightPillarsBackground enabled={enabled} />;
        case 'constellation':
          return <ConstellationBackground enabled={enabled} />;
        case 'gradientFlow':
          return <GradientFlowBackground enabled={enabled} />;
        default:
          return <DynamicAtmosphericBackground enabled={enabled} />;
      }
    };

    return (
      <View style={styles.root}>
        {renderBackground()}
        {showParticles && <StardustParticles enabled={dynamicBackgroundEnabled} />}
      </View>
    );
  },
);

DynamicBackground.displayName = 'DynamicBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
  },
});

export default DynamicBackground;
