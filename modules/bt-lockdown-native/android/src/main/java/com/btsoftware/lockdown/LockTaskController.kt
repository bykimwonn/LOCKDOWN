package com.btsoftware.lockdown

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context

/**
 * Kiosk / lock-task mode — the real defence against force-stop.
 *
 * On a normal install the app is only a *device admin*, which blocks the
 * accessibility screen uninstall step but does NOT stop the student from
 * force-stopping the app or swiping it out of recents. The only Android-native
 * way to close that hole is **device owner**:
 *
 *   adb shell dpm set-device-owner com.btsoftware.lockdown/.LockdownAdminReceiver
 *
 * Once the app is device owner (or provisioned through an EMM), it can call
 * setLockTaskPackages() and startLockTask() to pin the WHOLE device in kiosk
 * mode during a sealed session. While pinned:
 *   - BACK / HOME / RECENTS are disabled (no exit),
 *   - the app cannot be force-stopped from Settings or recents,
 *   - the only way out is the session ending and calling stopLockTask().
 *
 * This object is defensive: every helper returns without throwing when the app
 * is NOT device owner, so on a normal install the API simply reports
 * `available = false` and the app falls back to the overlay+admin tripwire.
 */
object LockTaskController {

  private const val OWNER_PKG = "com.btsoftware.lockdown"

  fun dpm(ctx: Context): DevicePolicyManager? =
    ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

  fun adminComponent(ctx: Context): ComponentName =
    ComponentName(ctx, LockdownAdminReceiver::class.java)

  /** True when the app is the active device owner (not just device admin). */
  fun isDeviceOwner(ctx: Context): Boolean {
    return try {
      val manager = dpm(ctx) ?: return false
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.JELLY_BEAN_MR2) {
        manager.isDeviceOwnerApp(ctx.packageName)
      } else {
        false
      }
    } catch (_: Throwable) {
      false
    }
  }

  /** True when the app is at least an active device admin. */
  fun isAdmin(ctx: Context): Boolean {
    return try {
      dpm(ctx)?.isAdminActive(adminComponent(ctx)) ?: false
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * Register this package as a lock-task (screen-pinning) whitelist entry.
   * Requires device owner. Call before startLockTask().
   */
  fun registerLockTask(ctx: Context): Boolean {
    try {
      val manager = dpm(ctx) ?: return false
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP && isDeviceOwner(ctx)) {
        manager.setLockTaskPackages(adminComponent(ctx), arrayOf(OWNER_PKG))
        return true
      }
      return false
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * Pin the whole device in kiosk mode. Must be called from an Activity that
   * is on top. Returns true if lock-task was requested; on a normal install it
   * returns false (and the caller falls back to the overlay seal).
   */
  fun pin(activity: Activity): Boolean {
    return try {
      if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.LOLLIPOP) return false
      if (!isDeviceOwner(activity)) return false
      registerLockTask(activity)
      activity.startLockTask()
      true
    } catch (_: Throwable) {
      false
    }
  }

  /** Release kiosk mode. Requires an Activity. Safe to call regardless. */
  fun unpin(activity: Activity) {
    try {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
        activity.stopLockTask()
      }
    } catch (_: Throwable) { }
  }

  /**
   * Device-owner-only: block uninstall + remove force-stop by setting the app
   * to be a lock-task package and (on API 28+) stripping every lock-task
   * feature except the power menu. Best-effort; never throws.
   *
   * There is NO DevicePolicyManager#setLockTaskModeState() and no
   * DevicePolicyManager#LOCK_TASK_MODE_PINNED (that constant lives on
   * ActivityManager). Calling them failed the Kotlin compile with
   * "unresolved reference" and broke every EAS Android release build. Lock
   * task mode is *entered* with Activity.startLockTask() (see pin()) and
   * *configured* with setLockTaskPackages()/setLockTaskFeatures() — both real
   * APIs, both used below.
   */
  fun harden(activity: Activity) {
    try {
      if (!isDeviceOwner(activity)) return
      registerLockTask(activity)
      val manager = dpm(activity) ?: return
      // Real uninstall block (API 21+): while we are device owner the seal
      // cannot be uninstalled. Throws SecurityException if we are not owner.
      manager.setUninstallBlocked(adminComponent(activity), activity.packageName, true)
      // API 28+: while the device is pinned, hide home / recents / notifications
      // and the status-bar info area. GLOBAL_ACTIONS is deliberately kept so the
      // phone can always be powered off — a seal must never trap the student
      // with a dead battery.
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
        manager.setLockTaskFeatures(
          adminComponent(activity),
          DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
        )
      }
    } catch (_: Throwable) { }
  }
}
