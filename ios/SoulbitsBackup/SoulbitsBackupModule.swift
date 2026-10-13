//
//  SoulbitsBackupModule.swift
//  HarmonyAIChat
//
//  Task 2-6 (iOS half, landed with 4-2) — the "SoulbitsBackup" native module.
//
//  The engine (Go) produces and validates the encrypted backup artifact and
//  stages it into a LOCAL INBOX directory (`ICloudContainerTarget`, engine-side
//  shape). This module owns the iOS-native half:
//
//    • the iCloud ubiquity container — moves inbox objects into
//      `Documents/soulbits-backups/` via NSFileCoordinator; the system `bird`
//      daemon uploads them (app death is irrelevant);
//    • NSMetadataQuery — upload progress + a container listing for the restore
//      screen;
//    • the W2 key wrap — a random 256-bit unlock key stored as a
//      `kSecAttrSynchronizable` Keychain item (kSecAttrAccessibleAfterFirstUnlock,
//      the app's keychain access group) that AEAD-wraps the backup DEK, so an
//      Apple-to-Apple restore needs zero user effort. The wrapped bytes are REAL
//      (ChaCha20-Poly1305); the engine's manifest W2 entry stays informational
//      (the key material lives in the Keychain, per modules/backup/crypto.go).
//
//  JS wrapper: src/services/backup/backupNativeIos.ts.
//

import Foundation
import Security
import CryptoKit
import React

/// The app's iCloud container (must match the `com.apple.developer.ubiquity-container-identifiers`
/// entitlement — see ios/HarmonyAIChat/HarmonyAIChat.entitlements).
private let kICloudContainerIdentifier = "iCloud.ai.soulbits.chat"
/// The container sub-directory the backup objects live in.
private let kContainerBackupDir = "soulbits-backups"

/// Keychain service names for the W2 wrap (both synchronizable).
private let kW2UnlockKeyService = "soulbits.backup.w2.unlock-key"
private let kW2WrappedService = "soulbits.backup.w2.wrapped-dek"

/// Keychain access group. When nil the item uses the app's default access group
/// (declared via the `keychain-access-groups` entitlement). Set this to the
/// group string (e.g. "$(AppIdentifierPrefix)ai.soulbits.chat") to share the
/// item explicitly — it must match an entry in the entitlements file.
private let kKeychainAccessGroup: String? = nil

@objc(SoulbitsBackup)
class SoulbitsBackupModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  // MARK: - Availability / probe

  /// True when the iCloud container is resolvable (entitlement + signed in).
  @objc func isAvailable(_ resolve: RCTPromiseResolveBlock,
                         reject: RCTPromiseRejectBlock) {
    resolve(resolvedContainerURL() != nil)
  }

  /// Availability + account identity for the restore screen / per-target status.
  @objc func probe(_ resolve: RCTPromiseResolveBlock,
                   reject: RCTPromiseRejectBlock) {
    guard let url = resolvedContainerURL() else {
      resolve(["available": false,
               "detail": "iCloud Drive is not available (not signed in, or the container entitlement is missing)"])
      return
    }
    let token = FileManager.default.ubiquityIdentityToken
    resolve(["available": true,
             "account": token != nil ? "iCloud" : "",
             "detail": url.path])
  }

  /// The container's backup directory (created on demand), or nil.
  @objc func containerURL(_ resolve: RCTPromiseResolveBlock,
                          reject: RCTPromiseRejectBlock) {
    guard let url = resolvedContainerURL() else { resolve(nil); return }
    resolve(url.path)
  }

  /// List the container's backup objects (`{name, size, modified}`).
  @objc func listContainer(_ resolve: RCTPromiseResolveBlock,
                           reject: RCTPromiseRejectBlock) {
    guard let dir = resolvedContainerURL() else { resolve([]); return }
    resolve(listFiles(in: dir))
  }

  // MARK: - Inbox ↔ container

  /// Move every object from the engine's local inbox into the container
  /// (backup path). Uses NSFileCoordinator so `bird` sees a consistent write.
  @objc func syncInboxToContainer(_ inboxDir: String,
                                  resolve: RCTPromiseResolveBlock,
                                  reject: RCTPromiseRejectBlock) {
    guard let dest = resolvedContainerURL() else {
      reject("icloud_unavailable", "iCloud container is not available", nil)
      return
    }
    do {
      let moved = try moveDirectoryContents(from: URL(fileURLWithPath: inboxDir), to: dest)
      resolve(["moved": moved])
    } catch {
      reject("icloud_sync_failed", error.localizedDescription, error)
    }
  }

  /// Copy the container's objects into the engine's local inbox (restore path).
  @objc func syncContainerToInbox(_ inboxDir: String,
                                  resolve: RCTPromiseResolveBlock,
                                  reject: RCTPromiseRejectBlock) {
    guard let src = resolvedContainerURL() else {
      reject("icloud_unavailable", "iCloud container is not available", nil)
      return
    }
    do {
      let copied = try copyDirectoryContents(from: src, to: URL(fileURLWithPath: inboxDir))
      resolve(["copied": copied])
    } catch {
      reject("icloud_sync_failed", error.localizedDescription, error)
    }
  }

  /// Aggregate upload progress over the container via NSMetadataQuery.
  @objc func uploadProgress(_ resolve: @escaping RCTPromiseResolveBlock,
                            reject: RCTPromiseRejectBlock) {
    guard let dir = resolvedContainerURL() else {
      resolve(["total": 0, "uploaded": 0, "percent": 0])
      return
    }
    let query = NSMetadataQuery()
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K BEGINSWITH %@",
                                  NSMetadataItemPathKey, dir.path)
    var observer: NSObjectProtocol?
    observer = NotificationCenter.default.addObserver(
      forName: .NSMetadataQueryDidFinishGathering,
      object: query,
      queue: .main
    ) { _ in
      query.disableUpdates()
      query.stop()
      if let observer = observer { NotificationCenter.default.removeObserver(observer) }

      var total = 0.0
      var uploaded = 0.0
      let count = query.resultCount
      for i in 0..<count {
        guard let item = query.result(at: i) as? NSMetadataItem else { continue }
        total += 1
        if let pct = item.value(forAttribute: NSMetadataUbiquitousItemPercentUploadedKey) as? Double,
           pct >= 100 {
          uploaded += 1
        }
      }
      let percent = total > 0 ? Int((uploaded / total) * 100.0) : 100
      resolve(["total": Int(total), "uploaded": Int(uploaded), "percent": percent])
    }
    query.start()
  }

  // MARK: - W2 key wrap (iCloud Keychain)

  /// Wrap the backup DEK under a synchronizable iCloud-Keychain unlock key.
  /// Returns the wrap entry (`{nonce, wrapped, hint}`) for the caller to record.
  @objc func putICloudWrap(_ dekBase64: String,
                           resolve: RCTPromiseResolveBlock,
                           reject: RCTPromiseRejectBlock) {
    guard let dek = Data(base64Encoded: dekBase64), dek.count == 32 else {
      reject("bad_dek", "DEK must be 32 base64-encoded bytes", nil)
      return
    }
    do {
      let key = try loadOrCreateUnlockKey()
      let sealed = try ChaChaPoly.seal(dek, using: key)
      let nonce = sealed.nonce.withUnsafeBytes { Data($0) }
      let combined = sealed.ciphertext + sealed.tag
      try keychainSet(service: kW2WrappedService,
                      value: try JSONSerialization.data(withJSONObject: [
                        "nonce": nonce.base64EncodedString(),
                        "wrapped": combined.base64EncodedString(),
                      ]),
                      synchronizable: true)
      resolve(["nonce": nonce.base64EncodedString(),
               "wrapped": combined.base64EncodedString(),
               "hint": "iCloud Keychain (W2)"])
    } catch {
      reject("w2_wrap_failed", error.localizedDescription, error)
    }
  }

  /// Read + unwrap the W2 DEK (Apple-to-Apple restore). Resolves nil when absent.
  @objc func getICloudWrap(_ resolve: RCTPromiseResolveBlock,
                           reject: RCTPromiseRejectBlock) {
    guard let wrappedData = try? keychainGet(service: kW2WrappedService, synchronizable: true),
          let obj = try? JSONSerialization.jsonObject(with: wrappedData) as? [String: String],
          let nonceB64 = obj["nonce"], let wrappedB64 = obj["wrapped"],
          let nonceData = Data(base64Encoded: nonceB64),
          let combined = Data(base64Encoded: wrappedB64),
          combined.count > 16,
          let key = try? loadOrCreateUnlockKey() else {
      resolve(nil)
      return
    }
    do {
      let nonce = try ChaChaPoly.Nonce(data: nonceData)
      let ciphertext = combined.prefix(combined.count - 16)
      let tag = combined.suffix(16)
      let box = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
      let dek = try ChaChaPoly.open(box, using: key)
      resolve(["dekBase64": dek.base64EncodedString()])
    } catch {
      reject("w2_unwrap_failed", error.localizedDescription, error)
    }
  }

  /// Remove the W2 wrap items (explicit "reset backup key").
  @objc func clearICloudWrap(_ resolve: RCTPromiseResolveBlock,
                             reject: RCTPromiseRejectBlock) {
    keychainDelete(service: kW2WrappedService, synchronizable: true)
    keychainDelete(service: kW2UnlockKeyService, synchronizable: true)
    resolve(true)
  }

  /// iCloud account status (`{signedIn, token}`).
  @objc func accountStatus(_ resolve: RCTPromiseResolveBlock,
                           reject: RCTPromiseRejectBlock) {
    let token = FileManager.default.ubiquityIdentityToken
    resolve(["signedIn": token != nil, "token": token != nil ? "iCloud" : ""])
  }

  // MARK: - Container helpers

  private func resolvedContainerURL() -> URL? {
    guard let base = FileManager.default.url(forUbiquityContainerIdentifier: kICloudContainerIdentifier) else {
      return nil
    }
    let dir = base.appendingPathComponent("Documents", isDirectory: true)
      .appendingPathComponent(kContainerBackupDir, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func listFiles(in dir: URL) -> [[String: Any]] {
    guard let entries = try? FileManager.default.contentsOfDirectory(
      at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else {
      return []
    }
    return entries.compactMap { url in
      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      return [
        "name": url.lastPathComponent,
        "size": values?.fileSize ?? 0,
        "modified": values?.contentModificationDate.map { ISO8601DateFormatter().string(from: $0) } ?? "",
      ]
    }
  }

  /// Move every file (recursively) from `from` into `to`, coordinated.
  @discardableResult
  private func moveDirectoryContents(from: URL, to: URL) throws -> Int {
    let fm = FileManager.default
    guard let entries = try? fm.contentsOfDirectory(at: from, includingPropertiesForKeys: nil) else {
      return 0
    }
    var moved = 0
    for entry in entries {
      let dest = to.appendingPathComponent(entry.lastPathComponent)
      try coordinateWrite(at: dest) {
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
        try fm.moveItem(at: entry, to: dest)
      }
      moved += 1
    }
    return moved
  }

  /// Copy every file (recursively) from `from` into `to`, coordinated.
  @discardableResult
  private func copyDirectoryContents(from: URL, to: URL) throws -> Int {
    let fm = FileManager.default
    try fm.createDirectory(at: to, withIntermediateDirectories: true)
    guard let entries = try? fm.contentsOfDirectory(at: from, includingPropertiesForKeys: nil) else {
      return 0
    }
    var copied = 0
    for entry in entries {
      let dest = to.appendingPathComponent(entry.lastPathComponent)
      try coordinateWrite(at: dest) {
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
        try fm.copyItem(at: entry, to: dest)
      }
      copied += 1
    }
    return copied
  }

  /// Run `body` under an NSFileCoordinator write coordination for `url`.
  private func coordinateWrite(at url: URL, _ body: () throws -> Void) throws {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordError: NSError?
    var innerError: Error?
    coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { _ in
      do { try body() } catch { innerError = error }
    }
    if let innerError = innerError { throw innerError }
    if let coordError = coordError { throw coordError }
  }

  // MARK: - Keychain (synchronizable)

  private func loadOrCreateUnlockKey() throws -> SymmetricKey {
    if let data = try? keychainGet(service: kW2UnlockKeyService, synchronizable: true), data.count == 32 {
      return SymmetricKey(data: data)
    }
    let key = SymmetricKey(size: .bits256)
    let raw = key.withUnsafeBytes { Data($0) }
    try keychainSet(service: kW2UnlockKeyService, value: raw, synchronizable: true)
    return key
  }

  private func baseQuery(service: String, synchronizable: Bool) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrSynchronizable as String: synchronizable ? kCFBooleanTrue! : kCFBooleanFalse!,
    ]
    if let group = kKeychainAccessGroup {
      query[kSecAttrAccessGroup as String] = group
    }
    return query
  }

  private func keychainSet(service: String, value: Data, synchronizable: Bool) throws {
    var query = baseQuery(service: service, synchronizable: synchronizable)
    SecItemDelete(query as CFDictionary)

    query[kSecValueData as String] = value
    // W2 must be readable after a device restart once unlocked (background wakes)
    // and syncs across the user's Apple devices.
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status),
                    userInfo: [NSLocalizedDescriptionKey: "keychain add failed (\(status))"])
    }
  }

  private func keychainGet(service: String, synchronizable: Bool) throws -> Data? {
    var query = baseQuery(service: service, synchronizable: synchronizable)
    query[kSecReturnData as String] = kCFBooleanTrue
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status),
                    userInfo: [NSLocalizedDescriptionKey: "keychain read failed (\(status))"])
    }
    return data
  }

  private func keychainDelete(service: String, synchronizable: Bool) {
    let query = baseQuery(service: service, synchronizable: synchronizable)
    SecItemDelete(query as CFDictionary)
  }
}
