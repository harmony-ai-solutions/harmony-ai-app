//
//  SoulbitsEngineModule.h
//  HarmonyAIChat
//
//  Task 4-2 — iOS in-process engine bridge.
//
//  A legacy React Native module (the repo's established pattern — see task
//  1-2's note: there is no `codegenConfig`/TurboModule spec infrastructure in
//  this project, and legacy modules are interop-supported under the new
//  architecture) that wraps the 4-1 gomobile facade (`SoulbitsEngine.xcframework`)
//  and exposes the SAME JS surface as the Android `EngineSidecar` module:
//
//      isAvailable() -> Promise<boolean>
//      start({dbKey?, dataDir?, logLevel?}) -> Promise<{rawLine, wsPort, ...}>
//      stop() -> Promise<void>
//      getState() -> Promise<EngineStatus>
//      call(method, payloadJSON) -> Promise<string>   // EngineCall (embedded only)
//      events: engine:ready | engine:state | engine:stopped | engine:error | engine:event
//
//  The engine lives and dies with the app process (iOS has no sidecar). See
//  src/services/engine/EngineEmbeddedModule.ts for the JS wrapper and
//  docs/Embed-Facade.md (engine repo) for the facade contract.
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface SoulbitsEngineModule : RCTEventEmitter <RCTBridgeModule>
@end
