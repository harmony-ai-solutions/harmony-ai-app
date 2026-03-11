# Harmony AI Chat

Open Source Android AI Chat Application - Your AI companions powered by your own backend or Harmony Cloud.

## 🎯 Project Overview

Harmony AI App is a React Native Android application that serves as a mobile frontend for the Harmony Link ecosystem. It provides:

- **Connected Mode**: Connect to your Harmony Link backend or Harmony Cloud
- **On-Device Mode**: Limited standalone operation with local AI models (future feature)
- **Privacy-First**: Full control over your data when using self-hosted backends
- **Open Source**: Completely transparent and customizable

## Implementation Progress

### Phase 1: Core Features
- [X] Chat interface with message list
- [X] Text input and message sending
- [X] Local data persistence (SQLite)
- [X] Backend integration (Harmony Link API)
- [X] Data Sync with Backend
- [X] Character selection
- [X] AI Audio message support (STT/TTS)
- [ ] AI Image viewing and generation

### Phase 2: Advanced Features
- [ ] On-device AI model integration / Full Offline Mode
- [ ] AI Lifecycle system - Define daily & weekly routines for characters + dynamic events based on lore
- [ ] Proactive AI behaviour - Initiates new conversations, Time Awareness, App Notifications
- [ ] Configure Settings and configuration in App directly (Harmony Link not needed)
- [ ] Custom character creation
- [ ] Voice Calls with AIs

### Phase 3: Premium Features
- [ ] Full Support for iOS Native App
- [ ] 3rd Party Messenger integrations (WhatsApp, Telegram, Discord etc)
- [ ] Group chats (Multi-Humans + AIs; Across Messengers)
- [ ] Video Share with AIs
- [ ] Cloud backup (GDrive, iCloud Drive)

## 📖 Documentation

- **Design Document**: See `design/00 Design Document.md`
- **Harmony Link**: https://github.com/harmony-ai-solutions/harmony-link-private
- **React Native**: https://reactnative.dev/
- **React Native Paper**: https://callstack.github.io/react-native-paper/

## Permissions

The Harmony AI app requires the following permissions:

### Android
- **RECORD_AUDIO**: Required for sending voice messages in chats
- **INTERNET**: Required for connecting to Harmony Link servers
- **CAMERA**: Required for sending images (requested only when used)

Permissions are requested at runtime when the feature is first used, following Android best practices.

## 🤝 Contributing

Contributions are welcome! This is an open-source project.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

Apache 2.0 License

See LICENSE file for details.

## 🔗 Links

- **GitHub**: https://github.com/harmony-ai-solutions/harmony-ai-app
- **Harmony AI Solutions**: https://github.com/harmony-ai-solutions
- **Project Harmony.AI**: https://project-harmony.ai

## 📋 Prerequisites for Developing on the Codebase

Before you begin, ensure you have the following installed:

> **Note for Windows users**: We recommend using [Chocolatey](https://chocolatey.org/install) package manager for easy installation. Install Chocolatey first, then use the `choco install` commands below.

### Required Software

1. **Node.js 18+ and npm**
   - Windows (with Chocolatey): `choco install nodejs-lts`
   - Or download from: https://nodejs.org/
   - Verify installation: `node --version` && `npm --version`

2. **JDK 17 (Java Development Kit)**
   - Windows (with Chocolatey): `choco install openjdk --version=17.0.2`
   - Set `JAVA_HOME` environment variable
   - Verify installation: `java --version`

3. **Android Studio**
   - Windows (with Chocolatey): `choco install androidstudio`
   - Or download from: https://developer.android.com/studio
   - Install Android SDK (API Level 33 or higher recommended)
   - Install Android SDK Platform-Tools
   - Install Android SDK Build-Tools

4. **Android SDK Setup**
   - Set `ANDROID_HOME` environment variable:
     - Windows: `C:\Users\<YourUsername>\AppData\Local\Android\Sdk`
     - macOS/Linux: `~/Library/Android/sdk` or `~/Android/Sdk`
   - Add to PATH:
     - `%ANDROID_HOME%\platform-tools` (Windows)
     - `$ANDROID_HOME/platform-tools` (macOS/Linux)

5. **Git**: For version control
  - Windows (with Chocolatey): `choco install git`
  - Or download from: https://git-scm.com/

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/harmony-ai-solutions/harmony-ai-app.git
   cd harmony-ai-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Verify React Native CLI**
   ```bash
   npx react-native doctor
   ```
   This will check your environment and report any issues.

## 📱 Development - Android Emulator

### Setup Android Virtual Device (AVD)

1. **Open Android Studio**
2. **Go to**: Tools → Device Manager (or AVD Manager)
3. **Create Virtual Device**:
   - Select a device definition (e.g., Pixel 6)
   - Select a system image (API 33+ recommended, x86_64)
   - Click "Finish"

### Launch the App in Emulator

1. **Start the Android Emulator**
   - Open Android Studio → Device Manager
   - Click the "Play" button next to your AVD
   - Wait for the emulator to fully boot

2. **Start Metro Bundler** (in project directory)
   ```bash
   npm start
   ```
   Or:
   ```bash
   npx react-native start
   ```

3. **Run the app** (in a new terminal)
   ```bash
   npm run android
   ```
   Or:
   ```bash
   npx react-native run-android
   ```

### Development Workflow

- **Hot Reload**: Shake the device or press `Ctrl+M` (Windows) / `Cmd+M` (Mac) → Enable Hot Reloading
- **Fast Refresh**: Automatic - saves time during development
- **Developer Menu**: Shake device or `Ctrl+M` / `Cmd+M`
- **Reload**: Press `R` twice or select "Reload" from developer menu
- **Chrome DevTools**: Select "Debug" from developer menu

## 📲 Development - Physical Android Device

### Enable Developer Options on Your Device

1. **Go to Settings → About Phone**
2. **Tap "Build Number" 7 times** until you see "You are now a developer!"
3. **Go back to Settings → System → Developer Options**
4. **Enable "USB Debugging"**
5. **Enable "Install via USB"** (if available)

### Connect via USB

1. **Connect your Android device** to your computer via USB cable

2. **Verify device connection**
   ```bash
   adb devices
   ```
   You should see your device listed. If prompted on your phone, **allow USB debugging**.

3. **Start Metro Bundler**
   ```bash
   npm start
   ```

4. **Run the app on your device**
   ```bash
   npm run android
   ```
   The app will be installed and launched on your device.

### Wireless Debugging (Android 11+)

1. **Enable Wireless Debugging** in Developer Options
2. **Connect to same Wi-Fi network** as your computer
3. **Pair device** (first time only):
   ```bash
   adb pair <IP_ADDRESS>:<PORT>
   # Enter pairing code shown on device
   ```
4. **Connect wirelessly**:
   ```bash
   adb connect <IP_ADDRESS>:<PORT>
   ```
5. **Run the app** as normal:
   ```bash
   npm run android
   ```

### Development on Physical Device

- **Shake gesture** opens developer menu
- **Three-finger tap** (some devices) also opens developer menu
- **Enable "Stay Awake"** in Developer Options to prevent screen timeout during development

## 🏗️ Project Structure (Outdated)

```
harmony-ai-app/
├── android/                 # Android native code
├── ios/                     # iOS native code (optional, not primary focus)
├── src/                     # Application source code
│   ├── components/          # Reusable UI components
│   │   └── common/         # Common components
│   ├── navigation/         # Navigation configuration
│   │   └── AppNavigator.tsx
│   ├── screens/            # Application screens
│   │   ├── HomeScreen.tsx
│   │   └── ChatScreen.tsx
│   ├── services/           # API and service integrations
│   │   └── api/           # Backend communication
│   ├── theme/              # Design system & theming
│   │   ├── colors.ts      # Color palette (Harmony Link design)
│   │   └── theme.ts       # React Native Paper theme
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Utility functions
├── design/                 # Design documents
├── App.tsx                 # Root component
├── index.js                # Entry point
├── package.json            # Dependencies
└── tsconfig.json           # TypeScript configuration
```

## 🛠️ Tech Stack

- **Framework**: React Native 0.83.1
- **Language**: TypeScript
- **Navigation**: React Navigation (Native Stack)
- **UI Library**: React Native Paper (Material Design 3)
- **Icons**: React Native Vector Icons
- **Storage**: AsyncStorage (foundation for future SQLite)
- **State Management**: React Hooks (Redux/Zustand can be added later)

### Design System

The app uses a custom dark theme matching Harmony Link's design:
- **Background**: `#282828` (rgb(40, 40, 40))
- **Surface**: `#404040`
- **Primary (Orange)**: `#ea580c`
- **Text**: `#f5f5f5` (primary), `#888888` (secondary)

## 🐛 Troubleshooting

### Common Setup Issues

#### ADB Command Not Found

**Issue**: `'"adb"' is not recognized as an internal or external command`

This means the Android SDK platform-tools directory is not in your system PATH.

**Solution (Windows)**:
1. **Locate your Android SDK** - typically:
   ```
   C:\Users\<YourUsername>\AppData\Local\Android\Sdk
   ```
2. **Add platform-tools to PATH**:
   - Open **System Properties** → **Environment Variables**
   - Under "System variables" (or "User variables"), find **Path**
   - Click **Edit** → **New**
   - Add: `C:\Users\<YourUsername>\AppData\Local\Android\Sdk\platform-tools`
   - Click **OK** to save
3. **Restart your terminal/IDE** to apply changes
4. **Verify**: Run `adb version` - you should see ADB version info

**Solution (macOS/Linux)**:
```bash
# Add to ~/.bashrc or ~/.zshrc
export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
# or
export ANDROID_HOME=$HOME/Android/Sdk  # Linux

export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin

# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc
```

**Alternative**: You can also set environment variables in Android Studio:
- Go to **File** → **Settings** (or **Preferences** on macOS)
- Navigate to **Appearance & Behavior** → **System Settings** → **Android SDK**
- Note the "Android SDK Location" path
- Use this path to set `ANDROID_HOME` and add `platform-tools` to PATH

#### Gradle Version Compatibility Error (IBM_SEMERU)

**Issue**: `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'`

This error occurs when using Gradle 9.0+ with React Native 0.83.1, which is not yet compatible with the latest Gradle version.

**Solution**: Use Gradle 8.13 (already configured in this project)

The project is configured to use Gradle 8.13 in `android/gradle/wrapper/gradle-wrapper.properties`:
```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.13-bin.zip
```

If you encounter this error:
1. **Verify the Gradle version** in `android/gradle/wrapper/gradle-wrapper.properties`
2. **Delete Gradle cache** if you previously downloaded a different version:
   ```bash
   # Windows
   rmdir /s /q %USERPROFILE%\.gradle\wrapper\dists\gradle-9.0.0-bin
   
   # macOS/Linux
   rm -rf ~/.gradle/wrapper/dists/gradle-9.0.0-bin
   ```
3. **Clean and rebuild**:
   ```bash
   cd android
   ./gradlew clean
   cd ..
   npm run android
   ```

**References**:
- [React Native 0.83 Gradle Compatibility Issue fixing tutorial](https://medium.com/@bebongnchuy/fixing-jvmvendorspec-ibm-semeru-and-java-25-errors-in-react-native-0-83-on-ubuntu-238b273cdb89)
- Gradle 8.13 is currently the recommended version for RN 0.83.1

#### Android SDK Environment Variables

**Issue**: Build fails with SDK location errors or "No emulators found"

**Solution**: Properly configure ANDROID_HOME environment variable

**Windows**:
1. **Find your Android SDK path**:
   - Open Android Studio → **Tools** → **SDK Manager**
   - Note the "Android SDK Location" (usually `C:\Users\<YourUsername>\AppData\Local\Android\Sdk`)
2. **Set ANDROID_HOME**:
   - Open **System Properties** → **Environment Variables**
   - Under "System variables", click **New**
   - Variable name: `ANDROID_HOME`
   - Variable value: `C:\Users\<YourUsername>\AppData\Local\Android\Sdk`
   - Click **OK**
3. **Add to PATH** (under System variables → Path → Edit → New):
   - `%ANDROID_HOME%\platform-tools`
   - `%ANDROID_HOME%\emulator`
   - `%ANDROID_HOME%\tools`
   - `%ANDROID_HOME%\tools\bin`
4. **Restart your terminal/IDE**
5. **Verify**:
   ```bash
   echo %ANDROID_HOME%
   adb version
   emulator -list-avds
   ```

**macOS**:
```bash
# Add to ~/.bash_profile or ~/.zshrc
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin

# Reload configuration
source ~/.bash_profile  # or source ~/.zshrc
```

**Linux**:
```bash
# Add to ~/.bashrc or ~/.profile
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin

# Reload configuration
source ~/.bashrc
```

**Verify your environment** after setting variables:
```bash
# Check ANDROID_HOME is set
echo $ANDROID_HOME  # Unix
echo %ANDROID_HOME%  # Windows

# Check ADB is accessible
adb version

# Check emulator command works
emulator -list-avds

# Run React Native doctor
npx react-native doctor
```

**References**:
- [Setting Android SDK Environment Variables](https://stackoverflow.com/questions/23042638/how-do-i-set-android-sdk-home-environment-variable)

#### JAVA_HOME Configuration

**Issue**: Build fails with "Could not find tools.jar" or Java version errors

**Solution**: Properly configure JAVA_HOME for JDK 17

**Windows**:
1. **Install JDK 17** choco install openjdk --version=17.0.2 --allow-downgrade
2. **Set JAVA_HOME**: Choco sould do this automatically
3. **Verify**: `java -version` should show version 17

**macOS/Linux**:
```bash
# Add to ~/.bash_profile or ~/.zshrc
export JAVA_HOME=$(/usr/libexec/java_home -v 17)  # macOS
# or
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64  # Linux

export PATH=$JAVA_HOME/bin:$PATH

# Verify
java -version
echo $JAVA_HOME
```

### Metro Bundler Issues

**Issue**: "Unable to resolve module"
```bash
# Clear Metro cache
npm start -- --reset-cache
# Or
npx react-native start --reset-cache
```

**Issue**: "Error: ENOSPC: System limit for number of file watchers reached"
```bash
# Linux only - increase file watcher limit
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Build Failures

**Issue**: Gradle build fails
```bash
cd android
./gradlew clean
cd ..
npm run android
```

**Issue**: "SDK location not found"
- Create `android/local.properties` with:
  ```
  sdk.dir=C:\\Users\\<YourUsername>\\AppData\\Local\\Android\\Sdk
  ```
  Note: Use double backslashes `\\` on Windows

**Issue**: "Execution failed for task ':app:installDebug'"
- Make sure an emulator is running or device is connected
- Check `adb devices` shows your device
- Try uninstalling the app first: `adb uninstall ai.projectharmony.chat`

**Issue**: "Long Path errors under Windows"
- by default, windows has a maximum path limit of 250 Chars. This can be fixed inside the Windows Registry with this command:
  ```pwsh
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```
- However, the gradle build wrapper might still encounter issues, because the ninja compiler shipping with the cmake version of the Android SDK cannot handle the extended path limit.

- References:
  - https://github.com/expo/expo/issues/36274#issuecomment-3051732073 => simplest solution
  - https://github.com/ninja-build/ninja/releases
  - https://github.com/AppAndFlow/react-native-safe-area-context/issues/424#issuecomment-2454869033
  
### Device Not Detected

**Issue**: `adb devices` shows no devices
```bash
# Restart ADB server
adb kill-server
adb start-server
adb devices
```

**Issue**: Device shows as "unauthorized"
- Check your phone for USB debugging prompt
- Revoke USB debugging authorizations (Developer Options) and try again
- Try a different USB cable (data transfer capable, not charge-only)

**Issue**: "error Failed to launch emulator. Reason: No emulators found"
1. **Create an AVD** in Android Studio → Device Manager
2. **Verify AVDs exist**: `emulator -list-avds`
3. **Start emulator manually** before running the app
4. **Check emulator PATH** is set correctly in environment variables

### App Crashes on Startup

1. **Check Metro Bundler** is running
2. **Verify all dependencies** are installed: `npm install`
3. **Clear app data**: Settings → Apps → Harmony AI → Storage → Clear Data
4. **Uninstall and reinstall** the app
5. **Check React Native version compatibility**: `npx react-native doctor`

### Port Already in Use

**Issue**: Metro port 8081 is already in use
```bash
# Windows
npx react-native start --port=8082

# Or kill process on port 8081
netstat -ano | findstr :8081
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:8081 | xargs kill
```

### Complete Environment Check

Run the React Native doctor command to verify your setup:
```bash
npx react-native doctor
```

This will check:
- ✓ Node.js version
- ✓ npm/yarn version
- ✓ Android SDK installation
- ✓ ANDROID_HOME environment variable
- ✓ Android Studio installation
- ✓ JDK installation
- ✓ Watchman (macOS/Linux)

Fix any issues reported before proceeding with development.

## 📚 Useful Commands

```bash
# Start development server
npm start

# Run on Android
npm run android

# Run on iOS (macOS only)
npm run ios

# Run tests
npm test

# Lint code
npm run lint

# Type check
npx tsc --noEmit

# Build APK for testing
cd android
./gradlew assembleDebug
# APK location: android/app/build/outputs/apk/debug/app-debug.apk
```

---

**Built with ❤️ by the Harmony AI Solutions team**
