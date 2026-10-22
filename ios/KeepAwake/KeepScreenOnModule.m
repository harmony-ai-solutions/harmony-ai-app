//
//  KeepScreenOnModule.m
//  HarmonyAIChat
//
//  Screen keep-awake bridge for the TTS test studio.
//
//  The test panel can play a longer synthesized sample; without a wake lock the
//  OS dims and sleeps the display mid-listen, the app backgrounds and the
//  biometric lock re-arms. This legacy RN module (the repo's established bridge
//  pattern — see SoulbitsEngineModule.m / SoulbitsNotificationsModule.m) exposes:
//
//      activate()   -> Promise<BOOL>
//      deactivate() -> Promise<BOOL>
//
//  Both toggle `UIScreen.mainScreen.idleTimerDisabled` on the main queue (UIKit
//  UI state must be touched there) and always resolve — teardown races are not
//  worth rejecting a promise over. The JS wrapper is
//  `src/services/keepScreenOn.ts`; the Android twin is
//  `android/.../keepawake/KeepScreenOnModule.kt` and uses the same module name,
//  so the wrapper is platform-agnostic.
//

#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

@interface KeepScreenOnModule : NSObject <RCTBridgeModule>
@end

@implementation KeepScreenOnModule

RCT_EXPORT_MODULE(KeepScreenOn)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

/** Keep the screen lit until `deactivate`. Idempotent. */
RCT_EXPORT_METHOD(activate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIScreen mainScreen].idleTimerDisabled = YES;
    resolve(@YES);
  });
}

/** Restore normal display sleep. Idempotent. */
RCT_EXPORT_METHOD(deactivate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIScreen mainScreen].idleTimerDisabled = NO;
    resolve(@YES);
  });
}

@end
