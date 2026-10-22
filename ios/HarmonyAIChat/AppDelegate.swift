import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import GoogleSignIn
import UserNotifications
import BackgroundTasks
import SoulbitsEngine

// ── Task 4-3: iOS blind-tick lifecycle constants ─────────────────────────
//
// The BGProcessingTask identifier MUST match `BGTaskSchedulerPermittedIdentifiers`
// in Info.plist (declared with 4-2). The notification names are the
// language-agnostic bridge between this coordinator and the ObjC engine module
// (`SoulbitsEngineModule.m`); the UserDefaults keys carry a wake/token queued
// before the RN bridge was listening (a cold background launch).
let kMaintenanceTaskIdentifier = "com.soulbits.engine.maintenance"
let kEngineWakeNotification = Notification.Name("SoulbitsEngineWake")
let kPushTokenNotification = Notification.Name("SoulbitsPushToken")
// 7-9: the pending-wake/token UserDefaults keys were renamed (soulbits.*).
// The ObjC bridge (SoulbitsEngineModule.m) owns the dual-read migration: it
// reads the new key, falls back to the legacy `harmony.*` key, then drops it.
let kPendingWakeKey = "soulbits.pendingWake"
let kPendingPushTokenKey = "soulbits.pendingPushToken"

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    // Restore any previous Google Sign-In session
    GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
      if let error = error {
        // Silent — no previous sign-in is expected on first launch
        _ = error
      }
    }

    factory.startReactNative(
      withModuleName: "Soulbits",
      in: window,
      launchOptions: launchOptions
    )

    // Task 4-3: register the BGProcessingTask handler + remote notifications and
    // submit the overnight maintenance request. Called AFTER startReactNative so
    // the engine module exists to receive wake/token notifications.
    EngineWakeCoordinator.shared.activate()

    return true
  }

  /// Handle the OAuth redirect URL from Google Sign-In.
  /// This is REQUIRED for the iOS native flow to complete — without it,
  /// the GIDSignIn callback never fires and the promise hangs forever.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return GIDSignIn.sharedInstance.handle(url)
  }

  // ── Task 4-3: push registration + silent-push wake ─────────────────────

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    EngineWakeCoordinator.shared.handleDeviceToken(deviceToken)
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    EngineWakeCoordinator.shared.handleRegistrationFailure(error)
  }

  /// Silent (`content-available`) pushes: the 4-4 hourly keepalive and data-only
  /// relay deliveries. The coordinator opens a background assertion, hands the
  /// wake to JS, and ALWAYS calls `completionHandler` (step 2 discipline).
  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    EngineWakeCoordinator.shared.handleRemoteNotification(userInfo, completion: completionHandler)
  }

  func applicationDidEnterBackground(_ application: UIApplication) {
    // Re-submit the overnight request each time we background (a BGProcessingTask
    // request is one-shot; iOS decides if/when to grant it).
    EngineWakeCoordinator.shared.scheduleMaintenance()
  }
}

/// Coordinates the two iOS background windows for the blind-tick lifecycle
/// (task 4-3): the silent-push wake (~30 s) and the overnight BGProcessingTask.
///
/// It owns ONLY the OS-facing discipline — background assertions, the OS
/// deadline, the completion handler, and BGTask registration/submission. The
/// actual work (batch / maintenance / relay) runs in JS and calls back via
/// `finishWake` (bridged by `SoulbitsEngineModule.m`).
final class EngineWakeCoordinator: NSObject {
  static let shared = EngineWakeCoordinator()

  /// The silent-push window we budget (strictly inside iOS's ~30 s grant).
  private let wakeTimeout: TimeInterval = 25

  private var activeTaskId: String?
  private var activeCompletion: ((UIBackgroundFetchResult) -> Void)?
  private var activeBGTask: BGProcessingTask?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var timeoutItem: DispatchWorkItem?

  private override init() {
    super.init()
  }

  /// Register handlers + notifications, then submit the first overnight request.
  func activate() {
    registerMaintenanceTask()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleWakeFinished(_:)),
      name: Notification.Name("SoulbitsEngineWakeFinished"),
      object: nil
    )
    registerForRemoteNotifications()
    scheduleMaintenance()
  }

  // ── Push registration ──────────────────────────────────────────────────

  private func registerForRemoteNotifications() {
    DispatchQueue.main.async {
      UIApplication.shared.registerForRemoteNotifications()
    }
  }

  func handleDeviceToken(_ token: Data) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    // Queue for the bridge (a cold launch may register before JS listens) and
    // post for a live bridge.
    UserDefaults.standard.set(hex, forKey: kPendingPushTokenKey)
    NotificationCenter.default.post(name: kPushTokenNotification, object: nil, userInfo: ["token": hex])
  }

  func handleRegistrationFailure(_ error: Error) {
    NSLog("[EngineWake] remote notification registration failed: %@", error.localizedDescription)
  }

  // ── Silent-push wake ───────────────────────────────────────────────────

  func handleRemoteNotification(
    _ userInfo: [AnyHashable: Any],
    completion: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard isContentAvailable(userInfo) else {
      completion(.noData)
      return
    }
    let kind = (userInfo["kind"] as? String) ?? "keepalive"
    beginWake(kind: kind, completion: completion)
  }

  private func isContentAvailable(_ userInfo: [AnyHashable: Any]) -> Bool {
    guard let aps = userInfo["aps"] as? [AnyHashable: Any] else { return false }
    if let n = aps["content-available"] as? NSNumber { return n.intValue == 1 }
    if let s = aps["content-available"] as? String { return s == "1" }
    return false
  }

  private func beginWake(
    kind: String,
    completion: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    // One wake at a time; a second arrival while busy is dropped (best-effort —
    // correctness converges on the next wake).
    if activeTaskId != nil {
      completion(.noData)
      return
    }
    let taskId = UUID().uuidString
    activeTaskId = taskId
    activeCompletion = completion
    beginBackgroundAssertion()

    queueWake(taskId: taskId, kind: kind)

    // Hard stop strictly inside the OS window; also the background-assertion
    // expiration path (whichever fires first).
    let item = DispatchWorkItem { [weak self] in self?.expireWake() }
    timeoutItem = item
    DispatchQueue.main.asyncAfter(deadline: .now() + wakeTimeout, execute: item)
  }

  /// Persist the wake (for a cold launch) + post it (for a live bridge).
  private func queueWake(taskId: String, kind: String) {
    let info: [String: Any] = ["taskId": taskId, "kind": kind]
    if let data = try? JSONSerialization.data(withJSONObject: info),
       let json = String(data: data, encoding: .utf8) {
      UserDefaults.standard.set(json, forKey: kPendingWakeKey)
    }
    NotificationCenter.default.post(name: kEngineWakeNotification, object: nil, userInfo: info)
  }

  @objc private func handleWakeFinished(_ note: Notification) {
    guard let taskId = note.userInfo?["taskId"] as? String, taskId == activeTaskId else { return }
    UserDefaults.standard.removeObject(forKey: kPendingWakeKey)
    completeActive(.newData)
  }

  /// Expiration: NO work after this point — stop the engine (its own tx
  /// checkpoint the in-flight entity) and complete the OS task.
  private func expireWake() {
    guard activeTaskId != nil else { return }
    var err: NSError?
    _ = EmbedEngineStop(&err)
    UserDefaults.standard.removeObject(forKey: kPendingWakeKey)
    completeActive(.noData)
  }

  private func completeActive(_ result: UIBackgroundFetchResult) {
    timeoutItem?.cancel()
    timeoutItem = nil
    let completion = activeCompletion
    let bgTask = activeBGTask
    activeTaskId = nil
    activeCompletion = nil
    activeBGTask = nil
    endBackgroundAssertion()
    completion?(result)
    bgTask?.setTaskCompleted(success: result == .newData)
  }

  private func beginBackgroundAssertion() {
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "SoulbitsEngineWake") { [weak self] in
      self?.expireWake()
    }
  }

  private func endBackgroundAssertion() {
    if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask)
      backgroundTask = .invalid
    }
  }

  // ── Overnight BGProcessingTask ─────────────────────────────────────────

  private func registerMaintenanceTask() {
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: kMaintenanceTaskIdentifier,
      using: nil
    ) { [weak self] task in
      guard let processing = task as? BGProcessingTask else { return }
      self?.handleMaintenanceTask(processing)
    }
  }

  /// Submit (or re-submit) the one-shot overnight request. Constraints per 2-6:
  /// external power + network — the sweep also rides the backup.
  func scheduleMaintenance() {
    let request = BGProcessingTaskRequest(identifier: kMaintenanceTaskIdentifier)
    request.requiresExternalPower = true
    request.requiresNetworkConnectivity = true
    request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 3600)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      // Already scheduled / unsupported on the simulator — non-fatal.
      NSLog("[EngineWake] BGProcessingTask submit skipped: %@", error.localizedDescription)
    }
  }

  private func handleMaintenanceTask(_ task: BGProcessingTask) {
    // Schedule the next window immediately (the current one is being consumed).
    scheduleMaintenance()
    activeBGTask = task

    task.expirationHandler = { [weak self] in
      var err: NSError?
      _ = EmbedEngineStop(&err)
      self?.completeActive(.noData)
    }

    if activeTaskId != nil {
      // A silent-push wake is already running; let it finish and complete this
      // window without work (best-effort).
      activeBGTask?.setTaskCompleted(success: false)
      activeBGTask = nil
      return
    }
    let taskId = UUID().uuidString
    activeTaskId = taskId
    activeCompletion = nil // completion is the BGTask itself
    queueWake(taskId: taskId, kind: "maintenance")
    // No fixed timeout: the BGProcessingTask expiration handler is the hard stop
    // (the JS sweep sets its own conservative engine deadline well before it).
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
