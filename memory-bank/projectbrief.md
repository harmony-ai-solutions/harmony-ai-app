# Harmony AI Chat - Project Brief

## Project Overview
Harmony AI Chat is an open-source Android mobile application that brings AI character interactions to mobile devices. It serves as the mobile frontend for the Harmony Link ecosystem, enabling users to chat with AI characters powered by their own backend or Harmony Cloud.

## Core Purpose
- Provide mobile access to AI character interactions from the Harmony Link ecosystem
- Enable chat functionality with AI characters on Android devices
- Support both connected mode (Harmony Link/Cloud) and on-device AI operation
- Deliver a privacy-first AI chat experience with user-controlled backends
- Serve as a testing field for messenger integration features

## High-Level Goals
1. **Mobile AI Chat**: Seamless AI character conversations on Android devices
2. **Dual Backend Support**: Connect to self-hosted Harmony Link or Harmony Cloud
3. **On-Device AI**: Limited standalone operation with local models (React Native Executorch)
4. **Privacy & Control**: Full data control when using self-hosted backends
5. **Messenger Integration**: Future support for WhatsApp, Telegram, etc. (premium feature)
6. **Open Source**: Community-driven development with transparent codebase

## Key Innovation
The app combines **mobile-first AI chat** with **flexible backend options** - users can choose between complete privacy with self-hosted Harmony Link or convenient cloud services. The unique **on-device AI capability** (via React Native Executorch) enables limited offline functionality, while the **messenger integration vision** aims to bring AI characters into everyday communication platforms.

## Target Users
- Privacy-conscious users wanting AI chat without cloud dependencies
- Harmony Link users seeking mobile access to their AI characters
- Power users who want full control over their AI interactions
- Content creators testing AI character behaviors on mobile
- Developers building AI chat applications

## Core Requirements
- Cross-platform mobile application (Android primary, iOS welcome as community contribution)
- React Native framework for efficient development
- Connection to Harmony Link backend (WebSocket/REST APIs)
- Local data persistence (SQLite) with sync capabilities
- On-device AI model support (React Native Executorch integration)
- Material Design 3 UI matching Harmony Link aesthetic
- Support for text, voice, and image interactions
- Character memory and personality persistence

## Project Status
**Current Phase**: Bootstrap Complete
- ✅ React Native project initialized with TypeScript
- ✅ Navigation structure implemented (React Navigation)
- ✅ Theme system matching Harmony Link design
- ✅ Basic screens (Home, Chat placeholders)
- ✅ Development documentation complete
- 🔄 Ready for feature development phase

## Design Document
Comprehensive design documentation available in `/design/00 Design Document.md` covering:
- Architecture (Connected Mode, On-Device Mode, Fallback)
- Memory system design for character persistence
- Behavioral components and time management
- Messenger integration roadmap
- Technical stack and implementation details
