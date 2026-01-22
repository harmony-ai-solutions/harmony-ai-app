const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Asset extensions for the bundler
    assetExts: ['db', 'mp3', 'ttf', 'obj', 'png', 'jpg'],
    sourceExts: ['js', 'json', 'ts', 'tsx', 'jsx'],
    
    // Override blockList to allow __tests__ directories (needed for in-app test runner)
    // By default, Metro excludes __tests__ folders, but we need them for DatabaseTestScreen
    blockList: null,
  },
};

module.exports = mergeConfig(defaultConfig, config);
