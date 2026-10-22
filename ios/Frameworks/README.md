# ios/Frameworks

Vendored native engine artifacts for iOS (task 4-2).

## `SoulbitsEngine.xcframework` (owner gate)

The 4-1 gomobile facade is compiled to `SoulbitsEngine.xcframework` on macOS +
Xcode and dropped here. The Xcode project references
`Frameworks/SoulbitsEngine.xcframework` (a STATIC framework — gomobile builds an
`-buildmode=c-archive` archive into the framework, so it is linked, not
embedded).

Build it from the **engine** repo (`harmony-link-private`, branch
`feat/app-engine-parity`) and copy it in:

```bash
# In harmony-link-private (macOS + Xcode required):
CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK' \
  ./build_facade_ios.sh
# → build/ios/SoulbitsEngine.xcframework

cp -R build/ios/SoulbitsEngine.xcframework \
  ../harmony-ai-app/ios/Frameworks/SoulbitsEngine.xcframework
```

The artifact is gitignored (`/ios/Frameworks/*.xcframework`) — like the Android
`jniLibs/**/libengine.so`, it is never committed.

The app target links `SoulbitsEngine.xcframework` from this directory
(`FRAMEWORK_SEARCH_PATHS = $(SRCROOT)/Frameworks`); `SoulbitsEngineModule.m`
imports `<SoulbitsEngine/SoulbitsEngine.h>`.

## Building the iOS app without the framework

`SoulbitsEngineModule.m` will fail to compile until the framework is present.
This is the documented 4-2 owner gate: build the XCFramework first (above), then
build the app. Everything else (TypeScript, tests, the Swift/ObjC sources, the
project wiring) is verified without it.
