package com.btsoftware.lockdown

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/**
 * JS bridge for Android enforcement.
 * The real-time intercept lives in [LockdownAccessibilityService] and the
 * session watchdog + full-screen barrier live in [LockdownOverlayService].
 */
class BTLockdownModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "BTLockdownModule"

  init {
    Bridge.attach(ctx)
  }

  @ReactMethod
  fun requestAccessibility(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
    } catch (_: Throwable) { }
    promise.resolve(isAccessibilityEnabled())
  }

  @ReactMethod
  fun requestOverlay(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
      try {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${ctx.packageName}")
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        ctx.startActivity(intent)
      } catch (_: Throwable) { }
    }
    promise.resolve(
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)
    )
  }

  @ReactMethod
  fun requestScreenTimeAuthorization(promise: Promise) {
    promise.resolve(false)
  }

  /**
   * Ask the student to enable BT LOCKDOWN as device admin (Tier 1 #6).
   * While admin is active the app cannot be silently uninstalled and the
   * admin cannot be switched off without firing LockdownAdminReceiver,
   * which reports tamper natively.
   */
  @ReactMethod
  fun requestDeviceAdmin(promise: Promise) {
    try {
      if (isAdminActive()) {
        promise.resolve(true)
        return
      }
      val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
        putExtra(
          DevicePolicyManager.EXTRA_DEVICE_ADMIN,
          ComponentName(ctx, LockdownAdminReceiver::class.java)
        )
        putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "BT LOCKDOWN uses this only to prevent the seal being removed mid-session. It never locks or wipes your device.")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
    } catch (_: Throwable) {
      // Some OEMs hide the admin screen; enforcement works without it.
    }
    promise.resolve(isAdminActive())
  }

  @ReactMethod
  fun requestBatteryExemption(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
          val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${ctx.packageName}")
          ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
          ctx.startActivity(intent)
        }
      } catch (_: Throwable) { }
    }
    promise.resolve(batteryIgnored())
  }

  @ReactMethod
  fun openAutostartSettings(promise: Promise) {
    // MIUI / Xiaomi autostart management. Not present on every OEM; best effort.
    val candidates = listOf(
      "com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity",
      "com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagerActivity",
      "com.iqoo.secure/com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"
    )
    for (flat in candidates) {
      try {
        val (pkg, cls) = flat.split("/", limit = 2)
        val intent = Intent().apply {
          component = ComponentName(pkg, cls)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
          ctx.startActivity(intent)
          promise.resolve(true)
          return
        }
      } catch (_: Throwable) { }
    }
    promise.resolve(false)
  }

  @ReactMethod
  fun getDeviceGuard(promise: Promise) {
    val map = Arguments.createMap()
    map.putString("accessibility", if (isAccessibilityEnabled()) "granted" else "denied")
    map.putString(
      "overlay",
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)) "granted" else "denied"
    )
    map.putString("battery", if (batteryIgnored()) "granted" else "denied")
    map.putString("admin", if (isAdminActive()) "granted" else "denied")
    map.putString("miui", if (isMiui()) "detected" else "none")
    map.putString("notifications", "pending")
    promise.resolve(map)
  }

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    val map = Arguments.createMap()
    map.putString("screenTime", "unavailable")
    map.putString("accessibility", if (isAccessibilityEnabled()) "granted" else "denied")
    map.putString(
      "overlay",
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)) "granted" else "denied"
    )
    map.putString("notifications", "pending")
    promise.resolve(map)
  }

  @ReactMethod
  fun activate(payload: ReadableMap, promise: Promise) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val blocked = payload.getArray("blockedPackages")?.toArrayList()?.joinToString(",") ?: ""
    val white = payload.getArray("whitelistPackages")?.toArrayList()?.joinToString(",") ?: ""
    val title = if (payload.hasKey("title")) payload.getString("title") ?: "Deep Work" else "Deep Work"
    val subject = if (payload.hasKey("subject")) payload.getString("subject") ?: "Study" else "Study"
    val token = if (payload.hasKey("token")) payload.getString("token") ?: "" else ""
    val armedBy = if (payload.hasKey("armedBy")) payload.getString("armedBy") ?: "sync" else "sync"
    prefs.edit()
      .putBoolean("active", true)
      .putString("sessionId", payload.getString("sessionId"))
      .putString("endsAt", payload.getString("endsAt"))
      .putString("blocked", blocked)
      .putString("whitelist", white)
      .putString("title", title)
      .putString("subject", subject)
      .putString("token", token)
      .putString("apiBase", if (payload.hasKey("apiBase")) payload.getString("apiBase") ?: "" else "")
      .putString("armedBy", armedBy)
      .putLong("startedAt", System.currentTimeMillis())
      // Fresh session: re-learn the server clock from the first tick.
      .putLong("clockOffsetMs", 0L)
      // Remember whether device admin was active at arm time, so the
      // watchdog can treat a mid-session removal as tamper (Tier 1 #6).
      .putBoolean("adminActive", isAdminActive())
      .apply()
    LockdownOverlayService.start(ctx)
    // Show the corner countdown for the session's remaining time even if the
    // full-screen barrier is not currently raised (e.g. student is in a safe app).
    val endsAt = parseIsoSafe(payload.getString("endsAt"))
    if (endsAt > 0L) LockdownOverlayService.corner(ctx, endsAt)
    promise.resolve(true)
  }

  @ReactMethod
  fun updateShield(payload: ReadableMap, promise: Promise) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // Defense in depth (Tier 1 #3): the Shield tab is disabled while sealed,
    // but refuse native-level changes too — nothing may shrink the shield
    // mid-session.
    if (prefs.getBoolean("active", false)) {
      promise.resolve(false)
      return
    }
    prefs.edit()
      .putString("blocked", payload.getArray("blockedPackages")?.toArrayList()?.joinToString(",") ?: "")
      .putString("whitelist", payload.getArray("whitelistPackages")?.toArrayList()?.joinToString(",") ?: "")
      .apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun deactivate(promise: Promise) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putBoolean("active", false).apply()
    LockdownOverlayService.cornerOff(ctx)
    LockdownOverlayService.stop(ctx)
    promise.resolve(true)
  }

  /** Start the keep-alive idle watchdog so the app auto-activates on timetable. */
  @ReactMethod
  fun startBackgroundGuard(promise: Promise) {
    LockdownOverlayService.startIdle(ctx)
    promise.resolve(true)
  }

  /** Show the corner countdown chip counting down to targetAt (epoch ms). */
  @ReactMethod
  fun showCornerTimer(targetAt: Double, promise: Promise) {
    LockdownOverlayService.corner(ctx, targetAt.toLong())
    promise.resolve(true)
  }

  @ReactMethod
  fun hideCornerTimer(promise: Promise) {
    LockdownOverlayService.cornerOff(ctx)
    promise.resolve(true)
  }

  @ReactMethod
  fun isEnforcing(promise: Promise) {
    val active = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean("active", false)
    promise.resolve(active && isAccessibilityEnabled())
  }

  private fun batteryIgnored(): Boolean {
    return try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) true
      else {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.isIgnoringBatteryOptimizations(ctx.packageName)
      }
    } catch (_: Throwable) {
      false
    }
  }

  private fun isMiui(): Boolean {
    val brand = (Build.BRAND ?: "").lowercase()
    val manufacturer = (Build.MANUFACTURER ?: "").lowercase()
    return brand.contains("xiaomi") || brand.contains("redmi") ||
      manufacturer.contains("xiaomi") || manufacturer.contains("redmi")
  }

  /** Parse a UTC ISO timestamp to epoch ms. Returns 0 on failure. */
  private fun parseIsoSafe(value: String?): Long {
    if (value.isNullOrBlank()) return 0L
    return try {
      val raw = value.trim().replace(' ', 'T')
      val noZone = raw.substringBefore('Z').substringBefore('+').substringBefore('.')
      val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("UTC")
      }
      fmt.parse(noZone)?.time ?: 0L
    } catch (_: Throwable) {
      0L
    }
  }

  private fun isAdminActive(): Boolean {
    return try {
      val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
      dpm?.isAdminActive(ComponentName(ctx, LockdownAdminReceiver::class.java)) ?: false
    } catch (_: Throwable) {
      false
    }
  }

  private fun isAccessibilityEnabled(): Boolean {
    val am = ctx.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    val list = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
    val me = ComponentName(ctx, LockdownAccessibilityService::class.java).flattenToString()
    return list.any { it.resolveInfo.serviceInfo.let { s -> ComponentName(s.packageName, s.name).flattenToString() } == me }
  }

  companion object {
    const val PREFS = "bt.lockdown"
  }
}
