package com.btsoftware.lockdown

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * Real-time launch interceptor.
 * Tuned for MIUI / Redmi: we listen to TYPE_WINDOW_STATE_CHANGED and
 * also TYPE_WINDOWS_CHANGED because some OEM launchers skip the first.
 *
 * State machine for the full-screen barrier:
 *  - student enters a SAFE app (BT LOCKDOWN, phone, SMS, in-call)  -> hide
 *  - student enters a BLOCKED app (or a browser without an allowed
 *    tab)                                                          -> HOME + show + emit
 *  - student enters a neutral, non-blocked app                     -> hide
 *  - launcher events (we just sent them HOME)                       -> no change
 */
class LockdownAccessibilityService : AccessibilityService() {

  /**
   * Hard-allow while sealed. These are system essentials the student must be
   * able to reach: the phone, the dialer, the in-call UI, the messaging app
   * (BT LEARNING) and the BT LOCKDOWN app itself. Everything else is subject
   * to default-deny below.
   *
   * Samsung One UI commonly renames/system-mirrors these (com.sec.myfiles,
   * com.samsung.android.messaging, etc.), so the OEM variants are included.
   *
   * NOTE: com.android.settings and com.android.systemui are deliberately NOT
   * here. Putting them here was the classic escape: the student opens
   * Settings to turn off the accessibility service, or pulls the notification
   * shade / recents, and the barrier would just drop. With default-deny those
   * are treated as a blocked launch instead.
   */
  private val SAFE_APPS = setOf(
    // Stock / AOSP
    "com.android.phone",
    "com.google.android.dialer",
    "com.android.incallui",
    "com.google.android.apps.messaging",
    "com.android.messaging",
    // Samsung One UI variants
    "com.samsung.android.messaging",
    "com.samsung.android.dialer",
    "com.samsung.android.contacts",
    "com.samsung.android.incallui",
    "com.sec.android.app.contacts",
    "com.sec.android.app.popupconverter",
    "com.samsung.android.app.telephonyui",
    // BT LEARNING companion
    "com.btsoftware.learning"
  )

  private val LAUNCHERS = setOf(
    // Xiaomi / MIUI / Redmi
    "com.miui.home",
    "com.miui.launcher",
    // AOSP / Pixel
    "com.android.launcher",
    "com.google.android.apps.nexuslauncher",
    // Samsung One UI
    "com.sec.android.app.launcher",
    "com.samsung.android.app.launcher",
    // Huawei / LG / Oppo / Vivo / OnePlus
    "com.huawei.android.launcher",
    "com.lge.launcher",
    "com.oppo.launcher",
    "com.vivo.launcher",
    "com.oneplus.launcher",
    "com.asus.launcher",
    "com.lenovo.launcher",
    "com.nokia.launcher",
    // Third-party
    "org.zwanoo.android.speedlauncher",
    "com.teslacoilsw.launcher"
  )

  private val BROWSERS = setOf(
    "com.android.chrome",
    "com.chrome.beta",
    "com.chrome.canary",
    "com.chrome.dev",
    "org.mozilla.firefox",
    "org.mozilla.firefox_beta",
    "org.mozilla.firefox_aurora",
    "com.microsoft.emmx",
    "com.microsoft.emmx.beta",
    "com.opera.browser",
    "com.opera.mini.native",
    "com.sec.android.app.sbrowser",
    "com.samsung.android.sbrowser",
    "com.mi.globalbrowser",
    "com.brave.browser",
    "com.duckduckgo.mobile.android",
    "com.uc.browser",
    "com.itscoders.dolphin",
    "com.browser.qq",
    "com.jamal.absbrowser"
  )

  private val BROWSER_ALLOWED = listOf(
    "bt learning",
    "btlearning",
    "youtube.com/watch",
    "youtu.be/",
    "khanacademy",
    "coursera"
  )

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (
      event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED
    ) return

    val pkg = event.packageName?.toString() ?: return
    if (pkg == packageName) {
      // Student is inside BT LOCKDOWN itself — safe zone.
      LockdownOverlayService.hide(this)
      return
    }

    val prefs = getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
    if (!prefs.getBoolean("active", false)) return

    // Launchers: we may have just sent the student HOME. Do nothing — leave
    // the home screen reachable so the student can open a SAFE app or return
    // to BT LOCKDOWN. The intercept happens at the app-open moment anyway, so
    // sealing the launcher itself is unnecessary and would only trap them
    // (default-deny still catches any non-whitelisted app they tap).
    if (pkg in LAUNCHERS) return

    // Hard-allow list: phone / dialer / in-call / messaging / BK LEARNING.
    // These are reachable even while sealed.
    if (pkg in SAFE_APPS) {
      LockdownOverlayService.hide(this)
      return
    }

    // Teacher-defined whitelist (study apps the student may open).
    val whitelist = (prefs.getString("whitelist", "") ?: "")
      .split(",").map { it.trim() }.filter { it.isNotEmpty() }
      .toHashSet()
    if (pkg in whitelist) {
      LockdownOverlayService.hide(this)
      return
    }

    // Browser carrying an allowed educational tab -> let it through.
    if (pkg in BROWSERS && browserTabAllowed(event)) {
      LockdownOverlayService.hide(this)
      return
    }

    // DEFAULT-DENY: anything that is not a hard-allow, whitelisted, or a
    // browser-with-allowed-tab is sealed. This is what makes the lock "system
    // level": it does not matter whether the app is on the teacher's shield
    // list. A brand-new game, a settings change, the notification shade, the
    // recents/app-switcher, a browser to an unauthorized site — all of it is
    // intercepted. Tunable bypass only via the explicit whitelist above.
    if (System.currentTimeMillis() - lastBlockAt > 1500) {
      lastBlockAt = System.currentTimeMillis()
      performGlobalAction(GLOBAL_ACTION_HOME)
      LockdownOverlayService.show(this)
      NativeReporter.report(
        this, "blocked", "block_attempt",
        "Intercepted launch of $pkg during a sealed session.", pkg
      )
    }
  }

  override fun onInterrupt() = Unit

  override fun onServiceConnected() {
    super.onServiceConnected()
    // Permission restored mid-session: nothing to do, the watchdog
    // stops warning on its own.
  }

  /**
   * The moment the student disables the accessibility (seal) service, Android
   * calls onUnbind()/onDestroy(). If a session is active, immediately report
   * the tamper AND lock the whole phone. This is faster than the 60s watchdog
   * poll — there is no window where turning the service off gives a free pass.
   */
  override fun onUnbind(intent: Intent?): Boolean {
    try {
      val active = getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
        .getBoolean("active", false)
      if (active) {
        NativeReporter.report(
          this, "accessibilityOff", "tamper_detected",
          "The accessibility (seal) service was switched off during a sealed session."
        )
        LockdownOverlayService.show(this)
      }
    } catch (_: Throwable) { }
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    try {
      val active = getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
        .getBoolean("active", false)
      if (active) {
        LockdownOverlayService.show(this)
      }
    } catch (_: Throwable) { }
    super.onDestroy()
  }

  private fun browserTabAllowed(event: AccessibilityEvent): Boolean {
    val hay = (event.text?.joinToString(" ") ?: "").lowercase()
    return BROWSER_ALLOWED.any { hay.contains(it) }
  }

  companion object {
    private var lastBlockAt = 0L
  }
}
