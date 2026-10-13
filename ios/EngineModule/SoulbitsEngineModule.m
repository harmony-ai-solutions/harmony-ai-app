//
//  SoulbitsEngineModule.m
//  HarmonyAIChat
//
//  Task 4-2 — iOS in-process engine bridge (see the header for the surface).
//
//  The gomobile facade (`embed` package) generates, into SoulbitsEngine.framework:
//
//      BOOL       EmbedEngineInit(NSString *configJSON, NSError **error);
//      NSString  *EmbedEngineStart(NSError **error);          // readiness JSON
//      BOOL       EmbedEngineStop(NSError **error);
//      NSString  *EmbedEngineCall(NSString *method, NSString *payloadJSON, NSError **error);
//      void       EmbedEngineSetEventCallback(id<EmbedEventHandler> cb);
//      NSString  *EmbedEngineVersion(void);
//      @protocol EmbedEventHandler <NSObject> - (void)onEvent:(NSString *)eventJSON; @end
//
//  (`Embed` is the capitalized `embed` package prefix; the callback selector is
//  `onEvent:` — gomobile lower-cases the first rune of Go's `OnEvent`.)
//
//  All of this runs on the app process; the engine binds the management + event
//  servers to 127.0.0.1 and the JS layer dials them directly (same code path as
//  the Android sidecar — see docs/Embed-Facade.md).
//

#import "SoulbitsEngineModule.h"

#import <SoulbitsEngine/SoulbitsEngine.h>
#import <React/RCTLog.h>
#import <mach/mach.h>

#pragma mark - Task 4-3 blind-tick constants
// MUST match AppDelegate.swift (EngineWakeCoordinator).
static NSString *const kEngineWakeNotificationName = @"SoulbitsEngineWake";
static NSString *const kEngineWakeFinishedNotificationName = @"SoulbitsEngineWakeFinished";
static NSString *const kPushTokenNotificationName = @"SoulbitsPushToken";
static NSString *const kPendingWakeDefaultsKey = @"soulbits.pendingWake";
// Legacy (pre-7-9) keys — dual-read migration: a wake/token queued by an older
// build lives under the old key; we read it, use it, then drop it.
static NSString *const kPendingWakeLegacyDefaultsKey = @"harmony.pendingWake";
static NSString *const kPendingPushTokenDefaultsKey = @"soulbits.pendingPushToken";
static NSString *const kPendingPushTokenLegacyDefaultsKey = @"harmony.pendingPushToken";

#pragma mark - Event handler (Go → host callback)

@class SoulbitsEngineModule;

/** Implements the gomobile-generated `EmbedEventHandler` protocol. */
@interface SoulbitsEngineEventHandler : NSObject <EmbedEventHandler>
@property (nonatomic, weak) SoulbitsEngineModule *module;
@end

#pragma mark - Module

@interface SoulbitsEngineModule ()
/** Last lifecycle status the JS `getState` reads: starting|ready|stopped|failed. */
@property (atomic, copy) NSString *status;
/** The one-shot facade event handler (retained for the process lifetime). */
@property (nonatomic, strong) SoulbitsEngineEventHandler *eventHandler;
@end

@implementation SoulbitsEngineModule

RCT_EXPORT_MODULE(SoulbitsEngine)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if (self = [super init]) {
    _status = @"stopped";
    _eventHandler = [SoulbitsEngineEventHandler new];
    _eventHandler.module = self;
    // Register the callback up-front so facade lifecycle events reach JS even
    // before the first start (EngineSetEventCallback may be called before
    // EngineStart).
    EmbedEngineSetEventCallback(_eventHandler);
    // Task 4-3: observe the native coordinator's wake + push-token posts and
    // forward them to JS (the OS-facing coordinator lives in AppDelegate.swift).
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(onEngineWakeNotification:)
                                                 name:kEngineWakeNotificationName
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(onPushTokenNotification:)
                                                 name:kPushTokenNotificationName
                                               object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"engine:ready", @"engine:state", @"engine:stopped", @"engine:error", @"engine:event",
            @"engine:wake", @"push:token" ];
}

#pragma mark - Bridge methods

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  // The framework is statically linked; presence of the module implies it.
  resolve(@YES);
}

RCT_EXPORT_METHOD(start:(NSDictionary *)options
                resolver:(RCTPromiseResolveBlock)resolve
                rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    NSString *dataDir = options[@"dataDir"];
    if (![dataDir isKindOfClass:[NSString class]] || dataDir.length == 0) {
      dataDir = [SoulbitsEngineModule defaultDataDir];
    }
    NSString *logLevel = options[@"logLevel"];
    if (![logLevel isKindOfClass:[NSString class]] || logLevel.length == 0) {
      logLevel = @"info";
    }

    NSMutableDictionary *cfg = [NSMutableDictionary dictionary];
    cfg[@"dataDir"] = dataDir;
    cfg[@"workingDir"] = dataDir;
    cfg[@"bind"] = @"127.0.0.1";
    cfg[@"logLevel"] = logLevel;
    cfg[@"logFile"] = @NO;
    // The DB key is app-owned (Keychain, task 4-2 custody). Absent → the engine
    // runs on its unencrypted default.
    NSString *dbKey = options[@"dbKey"];
    if ([dbKey isKindOfClass:[NSString class]] && dbKey.length > 0) {
      cfg[@"dbKey"] = dbKey;
    }

    NSData *cfgData = [NSJSONSerialization dataWithJSONObject:cfg options:0 error:nil];
    NSString *cfgJSON = [[NSString alloc] initWithData:cfgData encoding:NSUTF8StringEncoding];

    self.status = @"starting";

    NSError *err = nil;
    if (!EmbedEngineInit(cfgJSON, &err)) {
      self.status = @"failed";
      reject(@"engine_init_failed", [self messageForError:err], err);
      return;
    }

    NSString *ready = EmbedEngineStart(&err);
    if (err != nil || ready.length == 0) {
      self.status = @"failed";
      reject(@"engine_start_failed", [self messageForError:err], err);
      return;
    }

    self.status = @"ready";
    resolve([self readinessResultFromJSON:ready]);
  } @catch (NSException *exception) {
    self.status = @"failed";
    reject(@"engine_exception", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    NSError *err = nil;
    if (!EmbedEngineStop(&err)) {
      // The facade's EngineStop is idempotent and rarely fails; surface but keep
      // the status coherent (the engine is gone either way).
      self.status = @"stopped";
      reject(@"engine_stop_failed", [self messageForError:err], err);
      return;
    }
    self.status = @"stopped";
    resolve(@YES);
  } @catch (NSException *exception) {
    self.status = @"stopped";
    reject(@"engine_exception", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(getState:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(self.status ?: @"stopped");
}

/// Resident memory footprint of the app process (dev-build telemetry: RSS
/// before/after chat sessions — task 4-2 Design). Resolves 0 on failure.
RCT_EXPORT_METHOD(rssBytes:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  struct mach_task_basic_info info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  kern_return_t kr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                               (task_info_t)&info, &count);
  if (kr != KERN_SUCCESS) {
    resolve(@0);
    return;
  }
  resolve(@((double)info.resident_size));
}

RCT_EXPORT_METHOD(call:(NSString *)method
               payload:(NSString *)payloadJSON
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    NSError *err = nil;
    NSString *result = EmbedEngineCall(method, payloadJSON ?: @"", &err);
    if (err != nil) {
      reject(@"engine_call_failed", [self messageForError:err], err);
      return;
    }
    resolve(result ?: @"");
  } @catch (NSException *exception) {
    reject(@"engine_exception", exception.reason, nil);
  }
}

#pragma mark - Task 4-3: blind-tick wake / push-token bridge

/// Forward the native coordinator's wake to JS (`engine:wake`). The JS bridge
/// runs the bounded pass and calls `finishWake` to complete the OS task.
- (void)onEngineWakeNotification:(NSNotification *)note {
  NSDictionary *info = note.userInfo;
  NSString *taskId = [info[@"taskId"] isKindOfClass:[NSString class]] ? info[@"taskId"] : nil;
  if (taskId.length == 0) return;
  NSString *kind = [info[@"kind"] isKindOfClass:[NSString class]] ? info[@"kind"] : @"keepalive";
  NSMutableDictionary *body = [NSMutableDictionary dictionary];
  body[@"taskId"] = taskId;
  body[@"kind"] = kind;
  if (info[@"payload"]) body[@"payload"] = info[@"payload"];
  [self send:@"engine:wake" body:body];
}

- (void)onPushTokenNotification:(NSNotification *)note {
  NSString *token = [note.userInfo[@"token"] isKindOfClass:[NSString class]] ? note.userInfo[@"token"] : nil;
  if (token.length == 0) return;
  [self send:@"push:token" body:@{ @"token": token }];
}

/// Complete the OS task the coordinator opened for a wake (ends its background
/// assertion + calls the OS completion handler). Fire-and-forget.
RCT_EXPORT_METHOD(finishWake:(NSString *)taskId
                     result:(NSString *)resultJSON
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject) {
  if (taskId.length == 0) {
    resolve(@NO);
    return;
  }
  [[NSNotificationCenter defaultCenter] postNotificationName:kEngineWakeFinishedNotificationName
                                                      object:nil
                                                    userInfo:@{ @"taskId": taskId,
                                                                @"result": resultJSON ?: @"" }];
  resolve(@YES);
}

/// Drain a wake the coordinator queued before JS was listening (cold launch).
/// Resolves the wake dict (`{taskId,kind}`), or nil when there is none.
///
/// 7-9 dual-read migration: read the new `soulbits.pendingWake` key; on a miss,
/// fall back to the legacy `harmony.pendingWake` key (written by a pre-7-9
/// build) and consume it. Whichever key supplied the value is cleared.
RCT_EXPORT_METHOD(consumePendingWake:(RCTPromiseResolveBlock)resolve
                           rejecter:(RCTPromiseRejectBlock)reject) {
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSString *json = [defaults stringForKey:kPendingWakeDefaultsKey];
  if (json.length == 0) {
    // Upgrade path: an old build may have queued the wake under the legacy key.
    json = [defaults stringForKey:kPendingWakeLegacyDefaultsKey];
    if (json.length > 0) {
      [defaults removeObjectForKey:kPendingWakeLegacyDefaultsKey];
    }
  }
  if (json.length == 0) {
    resolve(nil);
    return;
  }
  [defaults removeObjectForKey:kPendingWakeDefaultsKey];
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  resolve([parsed isKindOfClass:[NSDictionary class]] ? parsed : nil);
}

/// Drain the APNs token queued before JS was listening. Resolves the token, or nil.
/// 7-9 dual-read migration: same new-key-then-legacy-key rule as `consumePendingWake`.
RCT_EXPORT_METHOD(consumePendingPushToken:(RCTPromiseResolveBlock)resolve
                                rejecter:(RCTPromiseRejectBlock)reject) {
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSString *token = [defaults stringForKey:kPendingPushTokenDefaultsKey];
  if (token.length == 0) {
    token = [defaults stringForKey:kPendingPushTokenLegacyDefaultsKey];
    if (token.length > 0) {
      [defaults removeObjectForKey:kPendingPushTokenLegacyDefaultsKey];
    }
  }
  if (token.length == 0) {
    resolve(nil);
    return;
  }
  [defaults removeObjectForKey:kPendingPushTokenDefaultsKey];
  resolve(token);
}

#pragma mark - Facade event → JS event

/** Called on the facade's dispatcher goroutine (never the main thread). */
- (void)handleFacadeEventJSON:(NSString *)eventJSON {
  if (eventJSON.length == 0) return;

  NSData *data = [eventJSON dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *env = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSString *kind = [env[@"kind"] isKindOfClass:[NSString class]] ? env[@"kind"] : @"engine:event";

  if ([kind isEqualToString:@"engine:ready"]) {
    self.status = @"ready";
    [self send:@"engine:ready" body:@{ @"rawLine": [self jsonStringFromObject:env[@"event"]] ?: @"" }];
    [self send:@"engine:state" body:@{ @"status": @"ready" }];
    return;
  }
  if ([kind isEqualToString:@"engine:started"]) {
    [self send:@"engine:state" body:@{ @"status": @"starting" }];
    return;
  }
  if ([kind isEqualToString:@"engine:stopped"]) {
    self.status = @"stopped";
    [self send:@"engine:stopped" body:@{}];
    [self send:@"engine:state" body:@{ @"status": @"stopped" }];
    return;
  }
  if ([kind isEqualToString:@"engine:error"]) {
    self.status = @"failed";
    NSString *message = [self jsonStringFromObject:env[@"event"]] ?: @"engine error";
    [self send:@"engine:error" body:@{ @"message": message }];
    [self send:@"engine:state" body:@{ @"status": @"failed" }];
    return;
  }
  // Non-lifecycle engine events (message:received / session:event / sync:event /
  // engine:event) — forwarded raw so a JS consumer can ride the callback instead
  // of the loopback WebSocket (the app's event bus uses the WS today; this keeps
  // the callback parity surface available).
  [self send:@"engine:event" body:@{ @"envelope": eventJSON }];
}

- (void)send:(NSString *)name body:(NSDictionary *)body {
  // `sendEventWithName:` is safe from any thread; hop to main for determinism.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:name body:body];
  });
}

#pragma mark - Helpers

/** App-private engine data dir (Library/Application Support/engine), excluded from iCloud backup. */
+ (NSString *)defaultDataDir {
  NSArray<NSString *> *paths =
      NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
  NSString *base = paths.firstObject ?: NSTemporaryDirectory();
  NSString *dir = [base stringByAppendingPathComponent:@"engine"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  NSURL *url = [NSURL fileURLWithPath:dir isDirectory:YES];
  // The engine DB is rebuilt from 2-6's user-owned-storage artifact, never from
  // an iCloud device backup — exclude it (Android's dataExtractionRules analogue).
  [url setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  return dir;
}

- (NSDictionary *)readinessResultFromJSON:(NSString *)readyJSON {
  NSData *data = [readyJSON dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  out[@"rawLine"] = readyJSON;
  if ([json isKindOfClass:[NSDictionary class]]) {
    out[@"wsPort"] = json[@"ws"] ?: @0;
    out[@"wssPort"] = json[@"wss"] ?: @0;
    out[@"adminPort"] = json[@"admin"] ?: @0;
    out[@"bind"] = json[@"bind"] ?: @"127.0.0.1";
    out[@"pid"] = json[@"pid"] ?: @(-1);
    out[@"dataDir"] = json[@"dataDir"] ?: @"";
    out[@"token"] = json[@"token"] ?: @"";
  }
  return out;
}

- (NSString *)jsonStringFromObject:(id)object {
  if (object == nil) return nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  if (data == nil) return nil;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (NSString *)messageForError:(NSError *)error {
  return error.localizedDescription ?: @"engine error";
}

@end

#pragma mark - Event handler implementation

@implementation SoulbitsEngineEventHandler
- (void)onEvent:(NSString *)eventJSON {
  [self.module handleFacadeEventJSON:eventJSON];
}
@end
