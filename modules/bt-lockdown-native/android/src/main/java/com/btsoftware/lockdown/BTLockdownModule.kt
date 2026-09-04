package com.btsoftware.lockdown

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.ActivityManager
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
   *
   * Some OEMs (notably MIUI/HyperOS) silently swallow
   * ACTION_ADD_DEVICE_ADMIN — the button then "does nothing" and the user
   * has to dig through system settings manually. We therefore try, in
   * order: the direct activation prompt -> the Device admin apps list ->
   * the Security settings screen, so the button always lands somewhere
   * the student can flip the switch.
   */
  @ReactMethod
  fun requestDeviceAdmin(promise: Promise) {
    try {
      if (isAdminActive()) {
        promise.resolve(true)
        return
      }
    } catch (_: Throwable) { }
    var opened = false
    // 1. The direct "Activate device admin" prompt.
    try {
      val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
        putExtra(
          DevicePolicyManager.EXTRA_DEVICE_ADMIN,
          ComponentName(ctx, LockdownAdminReceiver::class.java)
        )
        putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "BT LOCKDOWN uses this only to prevent the seal being removed mid-session. It never locks or wipes your device.")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
        ctx.startActivity(intent)
        opened = true
      }
    } catch (_: Throwable) { }
    // 2. The system "Device admin apps" list (launchable even when the
    //    direct prompt is suppressed).
    if (!opened) {
      try {
        val intent = Intent().apply {
          component = ComponentName("com.android.settings", "com.android.settings.DeviceAdminSettings")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (ctx.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
          ctx.startActivity(intent)
          opened = true
        }
      } catch (_: Throwable) { }
    }
    // 3. Last resort: Security settings — Device admin lives underneath it.
    if (!opened) {
      try {
        val intent = Intent(Settings.ACTION_SECURITY_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
        opened = true
      } catch (_: Throwable) { }
    }
    promise.resolve(isAdminActive() || opened)
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
    // OEM "allow in background / don't kill" management. Tuned per manufacturer.
    val candidates = when {
      isSamsung() -> listOf(
        // Samsung One UI: Battery → Background usage limits / Unmonitored apps
        "com.samsung.android.lool/com.samsung.android.sm.ui.battery.BatteryActivity",
        "com.samsung.android.lool/com.samsung.android.sm.ui.appmanagement.AppManagementActivity",
        "com.samsung.android.sm/com.samsung.android.sm.ui.battery.BatteryActivity"
      )
      isMiui() -> listOf(
        "com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity",
        "com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagerActivity"
      )
      else -> emptyList()
    } + listOf(
      "com.iqoo.secure/com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
      "com.huawei.systemmanager/com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
      "com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity",
      "com.coloros.safecenter/com.coloros.safecenter.startupapp.StartupAppListActivity",
      "com.vivo.permissionmanager/com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
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

  /** Convenience for the UI: is this a Samsung device? */
  @ReactMethod
  fun isSamsungDevice(promise: Promise) {
    promise.resolve(isSamsung())
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
    map.putString("owner", if (LockTaskController.isDeviceOwner(ctx)) "granted" else "denied")
    map.putString("kiosk", if (LockTaskController.isDeviceOwner(ctx) && isLockTaskActive()) "granted" else "denied")
    map.putString("miui", if (isMiui()) "detected" else "none")
    map.putString("notifications", "pending")
    // Informational: the network shield is an extra layer, never a precondition
    // for arming a session (a phone without its consent must still be sealable).
    map.putString("network", NetworkProtectionManager.mode(ctx))
    map.putString("protection", NetworkProtectionManager.protectionLevel(ctx))
    promise.resolve(map)
  }

  /** Enter kiosk / lock-task mode (device-owner only). Returns whether it worked. */
  @ReactMethod
  fun enterKiosk(promise: Promise) {
    val activity = currentActivity
    val ok = activity != null && LockTaskController.pin(activity)
    promise.resolve(ok)
  }

  /** Leave kiosk / lock-task mode. Safe to call on any build. */
  @ReactMethod
  fun exitKiosk(promise: Promise) {
    currentActivity?.let { LockTaskController.unpin(it) }
    promise.resolve(true)
  }

  /** True when the app is currently pinned in lock-task (kiosk) mode. */
  @ReactMethod
  fun isKiosk(promise: Promise) {
    promise.resolve(isLockTaskActive())
  }

  /**
   * Is the device currently pinned in lock-task (kiosk) mode?
   *
   * There is NO Activity#isInLockTaskMode — lock-task state is reported by
   * **ActivityManager**, and referencing it on an Activity fails
   * ':app:compileReleaseKotlin' with "unresolved reference". The two real
   * APIs are:
   *   - API 23+: ActivityManager.getLockTaskModeState() != LOCK_TASK_MODE_NONE
   *   - API 21/22: ActivityManager.isInLockTaskMode() (deprecated in 23)
   * This reads the state from the app context, so it is also correct when no
   * Activity is on top (the seal keeps running in the background).
   */
  private fun isLockTaskActive(): Boolean {
    return try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
      } else {
        @Suppress("DEPRECATION")
        am.isInLockTaskMode
      }
    } catch (_: Throwable) {
      false
    }
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
    // Fresh session: reset the per-session network-shield bookkeeping (breaks
    // used, blocked-for ceiling timer, retry backoff) and engage both layers.
    NetworkProtectionManager.onSessionArmed(ctx)
    LockdownOverlayService.enforceNow(ctx)
    // Show the corner countdown for the session's remaining time even if the
    // full-screen barrier is not currently raised (e.g. student is in a safe app).
    val endsAt = parseIsoSafe(payload.getString("endsAt"))
    if (endsAt > 0L) LockdownOverlayService.corner(ctx, endsAt)
    // If the app is Device Owner, pin the WHOLE device in lock-task (kiosk)
    // mode for the duration of the session — that is the real defence against
    // force-stop / recents removal. Best-effort; on a normal install this is
    // a no-op (isDeviceOwner == false).
    currentActivity?.let { LockTaskController.pin(it) }
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
    NetworkProtectionManager.release(ctx, "js-disarm")
    LockdownOverlayService.stop(ctx)
    // Release kiosk mode at session end.
    currentActivity?.let { LockTaskController.unpin(it) }
    promise.resolve(true)
  }

  /** Start the keep-alive idle watchdog so the app auto-activates on timetable. */
  @ReactMethod
  fun startBackgroundGuard(promise: Promise) {
    LockdownOverlayService.startIdle(ctx)
    LockdownOverlayService.enforceNow(ctx)
    promise.resolve(true)
  }

  // ----------------------------------------------------------------
  // Network shield (third enforcement layer) + seal health
  // ----------------------------------------------------------------

  /**
   * Everything the UI needs to tell the truth about protection: shield mode,
   * verified enforcement state, why it is not enforcing, and the seal layer's
   * health (bound / listed / why it last dropped).
   */
  @ReactMethod
  fun getProtectionStatus(promise: Promise) {
    val map = Arguments.createMap()
    NetworkProtectionManager.snapshot(ctx).forEach { (k, v) -> put(map, k, v) }
    val a11y = Arguments.createMap()
    AccessibilityHealth.snapshot(ctx).forEach { (k, v) -> put(a11y, k, v) }
    map.putMap("seal", a11y)
    map.putString("sealGuidance", AccessibilityHealth.guidance(ctx))
    map.putString("protection", NetworkProtectionManager.protectionLevel(ctx))
    promise.resolve(map)
  }

  /**
   * Arm the shield. `mode`: off | apps | strict.
   *
   * `consent` must be true (the on-screen explanation was accepted) unless the
   * device is school-provisioned device owner, where the institution supplies
   * the policy. Enabling it also needs the one-time system VPN allowance, so
   * when that is missing we launch the system dialog and report the state back —
   * the caller shows "tap Allow, then it is live" instead of pretending.
   */
  @ReactMethod
  fun setNetworkShield(mode: String, consent: Boolean, lockVpnUi: Boolean, promise: Promise) {
    val state = NetworkProtectionManager.setMode(ctx, mode, consent, lockVpnUi)
    if (mode != NetworkProtectionManager.MODE_OFF && !NetworkProtectionManager.isVpnPrepared(ctx) &&
      !LockTaskController.isDeviceOwner(ctx)
    ) {
      requestVpnConsentInternal()
    }
    val map = Arguments.createMap()
    NetworkProtectionManager.snapshot(ctx).forEach { (k, v) -> put(map, k, v) }
    map.putString("state", state)
    promise.resolve(map)
  }

  /** Launch the system "BT LOCKDOWN will start a VPN" dialog if still needed. */
  @ReactMethod
  fun requestNetworkShieldConsent(promise: Promise) {
    val already = NetworkProtectionManager.isVpnPrepared(ctx) ||
      LockTaskController.isDeviceOwner(ctx)
    if (!already) requestVpnConsentInternal()
    promise.resolve(already)
  }

  private fun requestVpnConsentInternal() {
    val i = NetworkProtectionManager.vpnPrepareIntent(ctx) ?: return
    try {
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(i)
    } catch (_: Throwable) { }
  }

  /** Bounded network-only break. The seal itself stays up. */
  @ReactMethod
  fun grantNetworkBreak(minutes: Double, promise: Promise) {
    promise.resolve(NetworkProtectionManager.grantBreak(ctx, minutes.toInt()))
  }

  /**
   * Local release of the shield. Only honoured while NO session is sealed: the
   * network block is the institution's policy for the duration of Deep Work, so
   * the way out of an active session is the timetable / the teacher ending it,
   * not a button in the app.
   */
  @ReactMethod
  fun releaseNetworkShield(promise: Promise) {
    val sealed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("active", false)
    if (sealed) {
      promise.resolve(false)
      return
    }
    NetworkProtectionManager.release(ctx, "manual")
    promise.resolve(true)
  }

  /**
   * Device-owner only: restrict accessibility services to BT LOCKDOWN's own, so
   * an installed "tap the toggle for me" automation app cannot be enabled.
   * Does NOT (and cannot) stop the student turning our seal off in Settings —
   * nothing an app may do can — and is offered as an explicit school policy.
   */
  @ReactMethod
  fun setAccessibilityAllowlist(enabled: Boolean, promise: Promise) {
    val ok = if (enabled) {
      AccessibilityHealth.applyAccessibilityAllowlist(ctx)
    } else {
      AccessibilityHealth.clearAccessibilityAllowlist(ctx)
    }
    promise.resolve(ok)
  }

  /** Open the system seal settings so a parent / teacher can re-enable it. */
  @ReactMethod
  fun openSealSettings(promise: Promise) {
    AccessibilityHealth.openAccessibilitySettings(ctx)
    promise.resolve(true)
  }

  private fun put(map: com.facebook.react.bridge.WritableMap, key: String, value: Any?) {
    when (value) {
      null -> map.putNull(key)
      is Boolean -> map.putBoolean(key, value)
      is Int -> map.putInt(key, value)
      is Double -> map.putDouble(key, value)
      is Long -> map.putDouble(key, value.toDouble())
      else -> map.putString(key, value.toString())
    }
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

  /**
   * Every launchable app on the phone, for the Shield tab's "detect apps on
   * this phone" scan. Uses a plain MAIN/LAUNCHER query (declared under
   * <queries> in the manifest) — no restricted QUERY_ALL_PACKAGES needed.
   * Returns [{packageId, name}] sorted by name; BT LOCKDOWN itself is
   * excluded (it is always whitelisted anyway).
   */
  @ReactMethod
  fun getInstalledApps(promise: Promise) {
    val out = Arguments.createArray()
    try {
      val pm = ctx.packageManager
      val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val resolved =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
        } else {
          @Suppress("DEPRECATION")
          pm.queryIntentActivities(intent, 0)
        }
      val seen = HashSet<String>()
      val apps = ArrayList<Pair<String, String>>()
      for (ri in resolved) {
        val pkg = ri.activityInfo?.packageName ?: continue
        if (pkg == ctx.packageName) continue
        if (!seen.add(pkg)) continue
        val label = try {
          ri.loadLabel(pm)?.toString()?.takeIf { it.isNotBlank() } ?: pkg
        } catch (_: Throwable) { pkg }
        apps.add(Pair(label, pkg))
      }
      apps.sortBy { it.first.lowercase() }
      for ((label, pkg) in apps) {
        val m = Arguments.createMap()
        m.putString("packageId", pkg)
        m.putString("name", label)
        out.pushMap(m)
      }
    } catch (_: Throwable) { }
    promise.resolve(out)
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

  private fun isSamsung(): Boolean {
    val brand = (Build.BRAND ?: "").lowercase()
    val manufacturer = (Build.MANUFACTURER ?: "").lowercase()
    return brand.contains("samsung") || manufacturer.contains("samsung")
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

  /**
   * "Is our seal service actually ON" — made robust against MIUI/HyperOS
   * false readings. Symptoms fixed here: the app claimed accessibility was
   * OFF while the toggle was visibly ON. Causes:
   *  1. The AccessibilityManager list can be stale right after the toggle —
   *     the authoritative source is Settings.Secure's
   *     ENABLED_ACCESSIBILITY_SERVICES string, which Android actually
   *     consults when binding services.
   *  2. One exact flattened name is compared, but OEMs flatten differently
   *     (long "pkg/pkg.Class" vs short "pkg/.Class").
   * We check both sources and match by package + class suffix.
   */
  private fun isAccessibilityEnabled(): Boolean {
    val pkg = ctx.packageName
    val cls = "LockdownAccessibilityService"
    // 1. AccessibilityManager (runtime view).
    try {
      val am = ctx.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
      val list = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      val hit = list.any { info ->
        val si = info.resolveInfo.serviceInfo
        si.packageName == pkg && si.name.substringAfterLast('.') == cls
      }
      if (hit) return true
    } catch (_: Throwable) { }
    // 2. Settings.Secure (authoritative binding view).
    return try {
      val enabled = Settings.Secure.getString(
        ctx.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      )
      if (enabled.isNullOrEmpty()) {
        false
      } else {
        val cn = ComponentName(ctx, LockdownAccessibilityService::class.java)
        val long = cn.flattenToString()        // pkg/pkg.LockdownAccessibilityService
        val short = cn.flattenToShortString()  // pkg/.LockdownAccessibilityService
        enabled.split(':').any {
          it.equals(long, ignoreCase = true) || it.equals(short, ignoreCase = true)
        }
      }
    } catch (_: Throwable) {
      false
    }
  }

  companion object {
    const val PREFS = "bt.lockdown"
  }
}
