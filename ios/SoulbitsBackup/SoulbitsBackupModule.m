//
//  SoulbitsBackupModule.m
//  HarmonyAIChat
//
//  ObjC bridge for the Swift `SoulbitsBackup` module (task 2-6 iOS half, landed
//  with 4-2). RN's `RCT_EXTERN_MODULE` is the standard way to expose a Swift
//  `@objc` class as a legacy bridge module.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SoulbitsBackup, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(probe:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(containerURL:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(listContainer:(RCTPromiseResolveBlock)resolve
                        reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(syncInboxToContainer:(NSString *)inboxDir
                               resolve:(RCTPromiseResolveBlock)resolve
                                reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(syncContainerToInbox:(NSString *)inboxDir
                               resolve:(RCTPromiseResolveBlock)resolve
                                reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(uploadProgress:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(putICloudWrap:(NSString *)dekBase64
                        resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getICloudWrap:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearICloudWrap:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(accountStatus:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)

@end
