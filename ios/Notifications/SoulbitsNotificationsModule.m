//
//  SoulbitsNotificationsModule.m
//  HarmonyAIChat
//
//  Task 5-1 add-on — iOS notification-authorization bridge.
//
//  The 4-3/4-4 push plumbing registers for **remote** notifications
//  (`UIApplication.registerForRemoteNotifications`, in `AppDelegate.swift`), which
//  is enough to receive `content-available` silent pushes and to obtain a device
//  token — but it does **not** grant permission to display a **visible banner**.
//  Without `UNUserNotificationCenter.requestAuthorization`, the 4-4 relay's
//  alert notifications are silently dropped by iOS. This legacy RN module (the
//  repo's established bridge pattern — see `SoulbitsEngineModule.m`) exposes the
//  authorization surface to JS so the app can ask at the natural point (the
//  Settings → Push notifications toggle) and degrade gracefully when denied.
//
//  Plan 7-12 §4a adds local-notification POSTING to the same module (the JS
//  wrapper is `src/services/notifications/LocalNotifications.ts`): the app's
//  events-WS outreach client raises an OS banner while backgrounded & alive.
//  The engine pre-renders title/body; the client decides preview-vs-generic
//  (lock-screen setting) before calling here. `messageId` is the request
//  identifier so a re-post for the same message REPLACES the pending request
//  rather than stacking a duplicate; `entityId` is the `threadIdentifier`.
//
//  JS surface (mirrored by `src/services/notifications/NotificationPermission.ts`
//  and `src/services/notifications/LocalNotifications.ts`):
//
//      requestAuthorization()    -> Promise<string>   // authorized|provisional|denied|notDetermined
//      getAuthorizationStatus()  -> Promise<string>
//      postLocalNotification({ title, body, entityId, messageId }) -> Promise<boolean>
//
//  Status strings are lowercase to match the JS union type. No UI is touched, so
//  the module does not require main-queue setup.
//

#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>

@interface SoulbitsNotificationsModule : NSObject <RCTBridgeModule>
@end

@implementation SoulbitsNotificationsModule

RCT_EXPORT_MODULE(SoulbitsNotifications)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

/** Lowercase status string matching the JS union in NotificationPermission.ts. */
- (NSString *)statusStringForStatus:(UNAuthorizationStatus)status
{
  switch (status) {
    case UNAuthorizationStatusNotDetermined:
      return @"notDetermined";
    case UNAuthorizationStatusDenied:
      return @"denied";
    case UNAuthorizationStatusAuthorized:
      return @"authorized";
    case UNAuthorizationStatusProvisional:
      return @"provisional";
#if defined(__IPHONE_14_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 140000
    case UNAuthorizationStatusEphemeral:
      return @"ephemeral";
#endif
    default:
      return @"notDetermined";
  }
}

/**
 * Request full authorization (alert + sound + badge) so visible banners can
 * display. Degrades gracefully: a prompt error resolves as `denied` rather than
 * rejecting, so the JS caller never has to guard a thrown promise.
 */
RCT_EXPORT_METHOD(requestAuthorization:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  UNAuthorizationOptions options =
      UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
  [center requestAuthorizationWithOptions:options
                        completionHandler:^(BOOL granted, NSError *_Nullable error) {
    if (error != nil) {
      // Not fatal — report the pre-prompt state so the caller degrades cleanly.
      resolve(@"notDetermined");
      return;
    }
    resolve(granted ? @"authorized" : @"denied");
  }];
}

/** Read the current authorization status without prompting. */
RCT_EXPORT_METHOD(getAuthorizationStatus:(RCTPromiseResolveBlock)resolve
                               rejecter:(RCTPromiseRejectBlock)reject)
{
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    resolve([self statusStringForStatus:settings.authorizationStatus]);
  }];
}

/**
 * Post a local notification (plan 7-12 §4a).
 *
 * `messageId` is required and used as the request identifier: adding a request
 * with the same identifier replaces the pending request instead of stacking a
 * duplicate. `entityId` becomes the `threadIdentifier` (iOS groups a thread's
 * notifications). A missing/blank messageId resolves `NO` rather than throwing.
 */
RCT_EXPORT_METHOD(postLocalNotification:(NSDictionary *)options
                            resolver:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *messageId = options[@"messageId"];
  if (![messageId isKindOfClass:[NSString class]] || messageId.length == 0) {
    resolve(@NO);
    return;
  }

  NSString *title = options[@"title"];
  NSString *body = options[@"body"];
  NSString *entityId = options[@"entityId"];

  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  content.title = [title isKindOfClass:[NSString class]] ? title : @"";
  content.body = [body isKindOfClass:[NSString class]] ? body : @"";
  content.sound = [UNNotificationSound defaultSound];
  if ([entityId isKindOfClass:[NSString class]] && entityId.length > 0) {
    content.threadIdentifier = entityId;
  }

  // trigger:nil → deliver immediately.
  UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:messageId content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter]
      addNotificationRequest:request
       withCompletionHandler:^(NSError *_Nullable error) {
    if (error != nil) {
      resolve(@NO);
      return;
    }
    resolve(@YES);
  }];
}

@end
