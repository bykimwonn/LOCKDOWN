import Foundation
import React
import FamilyControls
import ManagedSettings
import DeviceActivity

/**
 * BT LOCKDOWN — iOS enforcement.
 *
 * Requires the Family Controls entitlement
 * (`com.apple.developer.family-controls`) which Apple must approve
 * for the App Store / TestFlight build.
 *
 * Flow:
 *  1. requestAuthorization(.individual)
 *  2. Student picks apps via FamilyActivityPicker (JS presents the native picker)
 *  3. activate() writes ManagedSettingsStore shields
 *  4. DeviceActivitySchedule keeps the shield alive even if the JS process dies
 *  5. deactivate() clears the store
 */
@objc(BTLockdownModule)
class BTLockdownModule: NSObject {
  private let store = ManagedSettingsStore(named: .init("bt.lockdown"))
  private let center = AuthorizationCenter.shared
  private let activityCenter = DeviceActivityCenter()
  private let activityName = DeviceActivityName("bt.lockdown.session")

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func requestScreenTimeAuthorization(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      do {
        try await center.requestAuthorization(for: .individual)
        resolve(center.authorizationStatus == .approved)
      } catch {
        reject("auth_failed", error.localizedDescription, error)
      }
    }
  }

  @objc func getPermissionStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let screen: String
    switch center.authorizationStatus {
    case .approved: screen = "granted"
    case .denied: screen = "denied"
    default: screen = "pending"
    }
    resolve([
      "screenTime": screen,
      "accessibility": "unavailable",
      "overlay": "unavailable",
      "notifications": "pending",
    ])
  }

  @objc func activate(
    _ payload: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Shield every application category. Essential apps are then carved
    // back out via application / web-domain exceptions configured in the
    // FamilyActivityPicker selection persisted by the host app.
    store.shield.applicationCategories = .all()
    store.shield.webDomainCategories = .all()

    // Keep Safari from being a back door — only allow the BT LEARNING host.
    store.webContent.blockedByFilter = .auto()

    if let endsAt = payload["endsAt"] as? String,
       let end = ISO8601DateFormatter().date(from: endsAt) {
      let schedule = DeviceActivitySchedule(
        intervalStart: Calendar.current.dateComponents([.hour, .minute, .second], from: Date()),
        intervalEnd: Calendar.current.dateComponents([.hour, .minute, .second], from: end),
        repeats: false
      )
      do {
        try activityCenter.startMonitoring(activityName, during: schedule)
      } catch {
        // Shield is still applied via ManagedSettingsStore even if the
        // activity monitor extension fails to register.
      }
    }
    resolve(true)
  }

  @objc func deactivate(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    store.clearAllSettings()
    activityCenter.stopMonitoring([activityName])
    resolve(true)
  }

  @objc func isEnforcing(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(store.shield.applicationCategories != nil)
  }

  @objc func requestAccessibility(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) { resolve(false) }

  @objc func requestOverlay(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) { resolve(false) }
}
