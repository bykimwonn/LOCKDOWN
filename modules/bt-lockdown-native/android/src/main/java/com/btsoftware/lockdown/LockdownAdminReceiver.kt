package com.btsoftware.lockdown

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/**
 * Uninstall / tamper protection (Tier 1 #6).
 *
 * While this app is the active device admin, Android blocks silent
 * uninstall and refuses to disable the admin from the accessibility
 * screen without the "Remove device admin" flow — which fires
 * onDisabled(). That callback reports tamper natively (survives a dead
 * React process, see NativeReporter) so the ELO/streak penalty is
 * recorded even if the student then removes the seal entirely.
 *
 * Policy is intentionally empty: we never lock the screen, never wipe,
 * never restrict passwords. The admin role is used purely as a
 * tamper-evident tripwire — a "watch" admin, not MDM.
 */
class LockdownAdminReceiver : DeviceAdminReceiver() {

  override fun onDisabled(context: Context, intent: Intent) {
    super.onDisabled(context, intent)
    val active = context.getSharedPreferences(LockdownOverlayService.PREFS, Context.MODE_PRIVATE)
      .getBoolean("active", false)
    if (active) {
      NativeReporter.report(
        context, "adminDisabled", "tamper_detected",
        "Device admin removed during an active Deep Work session."
      )
    }
  }
}
