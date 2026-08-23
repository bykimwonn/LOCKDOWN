import ManagedSettings
import ManagedSettingsUI
import UIKit

/// App-extension target: `BTLockdownShield`.
/// Replaces Apple's default "Restricted" card with BT LOCKDOWN branding.
class BTLockdownShieldConfiguration: ShieldConfigurationDataSource {
  override func configuration(shielding application: Application) -> ShieldConfiguration {
    branded()
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    branded()
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    branded()
  }

  private func branded() -> ShieldConfiguration {
    ShieldConfiguration(
      backgroundBlurStyle: .systemUltraThinMaterialDark,
      backgroundColor: UIColor(red: 0.02, green: 0.02, blue: 0.02, alpha: 1),
      icon: UIImage(systemName: "lock.fill"),
      title: ShieldConfiguration.Label(text: "BT LOCKDOWN", color: .white),
      subtitle: ShieldConfiguration.Label(
        text: "Deep Work is active. This app is sealed until the session ends.",
        color: UIColor(white: 0.7, alpha: 1)
      ),
      primaryButtonLabel: ShieldConfiguration.Label(text: "Return to study", color: .black),
      primaryButtonBackgroundColor: UIColor(red: 1, green: 0.48, blue: 0.09, alpha: 1),
      secondaryButtonLabel: nil
    )
  }
}
