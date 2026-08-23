import DeviceActivity
import ManagedSettings

/// App-extension target: `BTLockdownMonitor`.
/// Xcode target membership must be the extension, not the host app.
/// This is what keeps the shield alive if the student force-kills BT LOCKDOWN.
final class BTLockdownMonitor: DeviceActivityMonitor {
  let store = ManagedSettingsStore(named: .init("bt.lockdown"))

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    store.shield.applicationCategories = .all()
    store.shield.webDomainCategories = .all()
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    store.clearAllSettings()
  }

  override func intervalWillEndWarning(for activity: DeviceActivityName) {
    super.intervalWillEndWarning(for: activity)
  }
}
