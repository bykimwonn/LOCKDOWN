package com.btsoftware.lockdown

import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.provider.Settings
import android.view.accessibility.AccessibilityManager

/**
 * AccessibilityHealth — the seal layer's own watchdog.
 *
 * The problem it solves: the accessibility service is the only thing that
 * intercepts a blocked app *launch*, and the OS (plus OEM battery managers)
 * owns its lifecycle. An app cannot bind, rebind or force-enable an
 * accessibility service — that decision belongs to system_server and to the
 * user. So this object does the two things that ARE supported:
 *
 *  1. DETECT the loss in well under a second instead of on the next 60 s poll,
 *     by watching the one place Android itself consults when it binds
 *     accessibility services: `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`.
 *     A ContentObserver fires the moment that string changes, which is when the
 *     student's toggle lands. The moment it flips off during a sealed session the
 *     hard seal goes up and the network shield engages, so "turn accessibility
 *     off" stops being a free pass — the escape window is what mattered, not
 *     superhuman persistence.
 *  2. HOOK the revival: when the system re-binds our service (after a process
 *     kill, after a boot, after the toggle comes back) [
 *     LockdownAccessibilityService.onServiceConnected] calls [onBound], which
 *     re-launches the watchdog foreground service and re-asserts the network
 *     policy. Before this, a process that was killed and then rebound by the
 *     system left the app with a live interceptor but a dead watchdog — nothing
 *     restarted the enforcement loop until the student opened the app again.
 *
 * It also records *why* the seal died, which is what turns "accessibility
 * switched off by itself" into something diagnosable: a user toggle, an OEM kill
 * (our process vanished while the setting still listed us), a crash, or a
 * rebind after boot. The fixes for those are different — battery exemption and
 * autostart for OEM kills, the allowlist policy for automation apps that tap the
 * toggle for the student, and nothing at all for a deliberate student toggle
 * except the seal + penalty + visible prompt.
 */
object AccessibilityHealth {

  private const val K_BOUND = "a11yBound"
  private const val K_BOUND_AT = "a11yBoundAt"
  private const val K_LAST_SEEN = "a11yLastSeenAt"
  private const val K_DROP_COUNT = "a11yDropCount"
  private const val K_LAST_DROP_AT = "a11yLastDropAt"
  private const val K_LAST_DROP_WHY = "a11yLastDropWhy"
  private const val K_RESTORE_COUNT = "a11yRestoreCount"
  private const val K_LIVE = "a11yLiveTickAt"

  /** Why the bound state ended. Written from the service callbacks. */
  const val WHY_USER_TOGGLE = "user_toggle"
  const val WHY_PROCESS_KILLED = "process_killed"
  const val WHY_REBOUND_AFTER_BOOT = "rebound_after_boot"
  const val WHY_NEVER_ENABLED = "never_enabled"

  /** Uptime under which a bind is attributed to boot rather than to a person. */
  private const val BOOT_WINDOW_MS = 30 * 60 * 1000L

  @Volatile
  private var observer: ContentObserver? = null

  @Volatile
  private var lastSeenEnabled = false

  private fun prefs(ctx: Context) =
    ctx.getSharedPreferences(LockdownOverlayService.PREFS, Context.MODE_PRIVATE)

  /**
   * Our service is enabled in the system's own list AND its process-side
   * handshake is alive. [LockdownAccessibilityService.onServiceConnected] ticks
   * a heartbeat every event and on bind, so a stale "enabled" setting (MIUI
   * keeps it after killing us) is caught instead of trusted.
   */
  fun isEnforcing(ctx: Context): Boolean = listedInSecureSettings(ctx) && serviceBound(ctx)

  /** True when our component is in Settings.Secure's enabled-services string. */
  fun listedInSecureSettings(ctx: Context): Boolean {
    return try {
      val enabled = Settings.Secure.getString(
        ctx.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      )
      if (enabled.isNullOrEmpty()) {
        false
      } else {
        val cn = android.content.ComponentName(ctx, LockdownAccessibilityService::class.java)
        val long = cn.flattenToString()
        val short = cn.flattenToShortString()
        enabled.split(':').any {
          it.equals(long, ignoreCase = true) || it.equals(short, ignoreCase = true)
        }
      }
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * True when the service object exists in this process. Cross-checked with the
   * AccessibilityManager list because a plain process-side flag is exactly what
   * goes stale after an OEM kill, and a plain settings read is exactly what goes
   * stale after a MIUI toggle.
   */
  fun serviceBound(ctx: Context): Boolean {
    if (LockdownAccessibilityService.connected) return true
    // The in-process flag can only be true if this process hosts the service. If
    // it is false, fall back to the system's live list (covers a rebind that
    // raced our read) and treat "listed but not bound" as NOT enforcing.
    return try {
      val am = ctx.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
      // FEEDBACK_ALL_MASK is on android.accessibilityservice.AccessibilityServiceInfo
      // — the fully-qualified form is what LockdownOverlayService uses too, and the
      // only version that compiles (there is no such constant on a
      // android.view.accessibility class).
      val list = am?.getEnabledAccessibilityServiceList(
        android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
      ) ?: emptyList()
      val pkg = ctx.packageName
      list.any { info ->
        val si = info.resolveInfo.serviceInfo
        si.packageName == pkg && si.name.substringAfterLast('.') == "LockdownAccessibilityService"
      }
    } catch (_: Throwable) {
      false
    }
  }

  // ------------------------------------------------------------------
  // sub-second loss detection
  // ------------------------------------------------------------------

  /**
   * Start watching `ENABLED_ACCESSIBILITY_SERVICES`. The callback is invoked on
   * [handler]'s thread; it must stay cheap — it only re-evaluates and delegates.
   */
  fun watch(ctx: Context, handler: Handler, onLost: () -> Unit, onRestored: () -> Unit) {
    if (observer != null) return
    val uri = try {
      Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
    } catch (_: Throwable) {
      null
    } ?: return
    val o = object : ContentObserver(handler) {
      override fun onChange(selfChange: Boolean) {
        evaluate(ctx, onLost, onRestored)
      }
    }
    try {
      ctx.contentResolver.registerContentObserver(uri, false, o)
      observer = o
      lastSeenEnabled = listedInSecureSettings(ctx)
    } catch (_: Throwable) { }
  }

  fun unwatch(ctx: Context) {
    observer?.let {
      try {
        ctx.contentResolver.unregisterContentObserver(it)
      } catch (_: Throwable) { }
    }
    observer = null
  }

  /** Edge-triggered check used by the observer and by every watchdog tick. */
  fun evaluate(ctx: Context, onLost: () -> Unit, onRestored: () -> Unit) {
    val now = listedInSecureSettings(ctx)
    if (now == lastSeenEnabled) return
    lastSeenEnabled = now
    if (now) onRestored() else onLost()
  }

  // ------------------------------------------------------------------
  // called from LockdownAccessibilityService
  // ------------------------------------------------------------------

  fun onBound(ctx: Context) {
    val p = prefs(ctx)
    val reason = boundReason(ctx, p)
    val now = System.currentTimeMillis()
    val edit = p.edit()
      .putBoolean(K_BOUND, true)
      .putLong(K_BOUND_AT, android.os.SystemClock.elapsedRealtime())
      .putLong(K_LAST_SEEN, now)
      .putLong(K_LIVE, now)
    if (p.getInt(K_DROP_COUNT, 0) > 0) edit.putInt(K_RESTORE_COUNT, p.getInt(K_RESTORE_COUNT, 0) + 1)
    edit.putString("a11yBoundWhy", reason)
      .apply()
  }

  /**
   * Why did the service come back? Advisory text for the school, but it turns a
   * support ticket around: "the phone reboots and the seal vanishes" is an OEM
   * battery policy, "it comes back when I open the app" is a student toggle.
   * Never reads anything expensive: one prefs int and the uptime clock.
   */
  private fun boundReason(ctx: Context, p: android.content.SharedPreferences): String {
    if (p.getLong(K_BOUND_AT, 0L) == 0L && p.getInt(K_DROP_COUNT, 0) == 0) return "first_bind"
    if (!listedInSecureSettings(ctx)) return "bound_while_unlisted"
    // Bound less than 30 minutes after the device booted => the system re-bound us
    // at boot, which is what a "it dies every night" report actually looks like.
    return if (android.os.SystemClock.elapsedRealtime() < BOOT_WINDOW_MS) WHY_REBOUND_AFTER_BOOT else "user_re_enabled"
  }

  @Volatile
  private var lastFlushAt = 0L

  @Volatile
  private var lastEventAt = 0L

  /**
   * Heartbeat from onAccessibilityEvent — proves the *callback path* is live,
   * which is what separates "the toggle is still on but the OEM killed us" from
   * "we are really running". onAccessibilityEvent fires often, so the timestamp
   * is kept in memory and flushed to prefs at most once every 30 s; the
   * watchdog reads the in-memory value first and only falls back to prefs.
   */
  fun tick(ctx: Context) {
    lastEventAt = System.currentTimeMillis()
    if (lastEventAt - lastFlushAt < 30_000L) return
    lastFlushAt = lastEventAt
    try {
      prefs(ctx).edit().putLong(K_LIVE, lastEventAt).apply()
    } catch (_: Throwable) { }
  }

  /**
   * The service was unbound. Classify it: our process is still alive (so this is
   * a real unbind, i.e. the user or the system took the grant away) versus a
   * dying process, which cannot report anything and is detected on the other
   * side when the watchdog finds `a11yLiveTickAt` gone stale.
   */
  fun onUnbound(ctx: Context) {
    val p = prefs(ctx)
    val wasBound = p.getBoolean(K_BOUND, false)
    // Android delivers onUnbind() AND onDestroy() for the same unbind; the second
    // call must not overwrite the recorded cause (it would downgrade a real
    // "user_toggle" into "never_enabled" and hide the diagnosis).
    if (!wasBound && p.getLong(K_BOUND_AT, 0L) > 0L) return
    val why = if (wasBound) WHY_USER_TOGGLE else WHY_NEVER_ENABLED
    val edit = p.edit()
      .putBoolean(K_BOUND, false)
      .putString(K_LAST_DROP_WHY, why)
      .putLong(K_LAST_DROP_AT, System.currentTimeMillis())
    if (wasBound) edit.putInt(K_DROP_COUNT, p.getInt(K_DROP_COUNT, 0) + 1)
    edit.apply()
  }

  /** Called by the watchdog when it finds the setting lists us but we are not bound. */
  fun noteProcessLost(ctx: Context) {
    val p = prefs(ctx)
    if (p.getBoolean(K_BOUND, false)) return
    p.edit()
      .putString(K_LAST_DROP_WHY, WHY_PROCESS_KILLED)
      .putLong(K_LAST_DROP_AT, System.currentTimeMillis())
      .putInt(K_DROP_COUNT, p.getInt(K_DROP_COUNT, 0) + 1)
      .apply()
  }

  /** Milliseconds since the accessibility callback path last ran (huge = dead). */
  fun liveAgeMs(ctx: Context): Long {
    val at = if (lastEventAt > 0L) lastEventAt else prefs(ctx).getLong(K_LIVE, 0L)
    if (at == 0L) return Long.MAX_VALUE / 2
    return (System.currentTimeMillis() - at).coerceAtLeast(0L)
  }

  fun snapshot(ctx: Context): Map<String, Any?> {
    val p = prefs(ctx)
    val listed = listedInSecureSettings(ctx)
    val bound = serviceBound(ctx)
    return mapOf(
      "enforcing" to (listed && bound),
      "listedInSettings" to listed,
      "boundInProcess" to bound,
      "dropCount" to p.getInt(K_DROP_COUNT, 0),
      "restoreCount" to p.getInt(K_RESTORE_COUNT, 0),
      "lastDropAt" to p.getLong(K_LAST_DROP_AT, 0L),
      "lastDropWhy" to (p.getString(K_LAST_DROP_WHY, "") ?: ""),
      "boundWhy" to (p.getString("a11yBoundWhy", "") ?: ""),
      "liveAgeSeconds" to (liveAgeMs(ctx) / 1000L).toInt(),
      "watching" to (observer != null)
    )
  }

  /**
   * Actionable cause for the UI. Only reported when the seal is actually down
   * during a session — otherwise the app nags about a permission it has.
   */
  fun guidance(ctx: Context): String {
    val p = prefs(ctx)
    val why = p.getString(K_LAST_DROP_WHY, "") ?: ""
    val batteryIgnored = try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(ctx.packageName)
    } catch (_: Throwable) {
      false
    }
    val miui = isMiui(ctx)
    return when {
      listedInSecureSettings(ctx) && !batteryIgnored ->
        "Android still lists the seal service, but our process was killed. Turn off " +
          "battery optimization for BT LOCKDOWN" +
          (if (miui) " and allow Autostart in MIUI Security" else "") + ", then re-enable " +
          "the service."
      why == WHY_USER_TOGGLE ->
        "The seal service was switched off on this device. Re-enable it in Settings → " +
          "Accessibility → BT LOCKDOWN; the network shield stays on meanwhile."
      why == WHY_PROCESS_KILLED ->
        "The device killed BT LOCKDOWN in the background. Disable battery " +
          "optimization" + (if (miui) " and lock the app in recents / allow autostart" else "") +
          ", then re-enable the seal service."
      why == WHY_NEVER_ENABLED ->
        "The seal service has never been enabled on this device."
      else ->
        "Enable the BT LOCKDOWN seal service in Settings → Accessibility."
    }
  }

  /**
   * Device-owner only: restrict accessibility services to this package (plus
   * whatever the school already permits). This does NOT stop the student from
   * toggling our own service off — nothing an app can do does — it removes the
   * "install a tapping macro / automation app and let it switch BT LOCKDOWN
   * off" route, which is the escape that actually scales.
   *
   * @return true when the restriction is in place.
   */
  fun applyAccessibilityAllowlist(ctx: Context): Boolean {
    if (!LockTaskController.isDeviceOwner(ctx)) return false
    val manager = LockTaskController.dpm(ctx) ?: return false
    return try {
      // setPermittedAccessibilityServices returns void, so the call and the
      // answer are separate statements (returning it would be a type error).
      manager.setPermittedAccessibilityServices(LockTaskController.adminComponent(ctx), listOf(ctx.packageName))
      true
    } catch (_: Throwable) {
      false
    }
  }

  fun clearAccessibilityAllowlist(ctx: Context): Boolean {
    if (!LockTaskController.isDeviceOwner(ctx)) return false
    val manager = LockTaskController.dpm(ctx) ?: return false
    return try {
      // null = "no restriction". NOT emptyList(): an empty list would permit only
      // the built-in system services, i.e. TalkBack and every other accessibility
      // service on the device would be permanently forbidden for the student.
      manager.setPermittedAccessibilityServices(LockTaskController.adminComponent(ctx), null)
      true
    } catch (_: Throwable) {
      false
    }
  }

  /** Settings entry point for the school/parent to put the seal back on. */
  fun openAccessibilitySettings(ctx: Context) {
    try {
      ctx.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (_: Throwable) { }
  }

  private fun isMiui(ctx: Context): Boolean {
    val brand = (android.os.Build.BRAND ?: "").lowercase()
    val maker = (android.os.Build.MANUFACTURER ?: "").lowercase()
    return brand.contains("xiaomi") || brand.contains("redmi") ||
      maker.contains("xiaomi") || maker.contains("redmi")
  }
}
