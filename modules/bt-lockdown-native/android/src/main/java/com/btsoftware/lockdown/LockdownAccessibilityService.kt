package com.btsoftware.lockdown

import android.accessibilityservice.AccessibilityService
import android.content.Context
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

  private val SAFE_APPS = setOf(
    "com.android.phone",
    "com.google.android.dialer",
    "com.android.incallui",
    "com.android.systemui",
    "com.android.settings",
    "com.google.android.apps.messaging",
    "com.btsoftware.learning"
  )

  private val LAUNCHERS = setOf(
    "com.miui.home",
    "com.miui.launcher",
    "com.android.launcher",
    "com.google.android.apps.nexuslauncher",
    "com.huawei.android.launcher",
    "com.oppo.launcher",
    "com.sec.android.app.launcher",
    "com.vivo.launcher"
  )

  private val BROWSERS = setOf(
    "com.android.chrome",
    "com.chrome.beta",
    "com.chrome.canary",
    "org.mozilla.firefox",
    "org.mozilla.firefox_beta",
    "com.microsoft.emmx",
    "com.opera.browser",
    "com.sec.android.app.sbrowser",
    "com.mi.globalbrowser",
    "com.brave.browser"
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

    // Launchers: we may have just sent the student HOME — keep barrier state.
    if (pkg in LAUNCHERS) return

    // Neutral app the student chose: not blocked, so let it through.
    if (pkg in SAFE_APPS) {
      LockdownOverlayService.hide(this)
      return
    }

    val whitelist = (prefs.getString("whitelist", "") ?: "")
      .split(",").map { it.trim() }.filter { it.isNotEmpty() }
      .toHashSet()
    if (pkg in whitelist) {
      LockdownOverlayService.hide(this)
      return
    }

    // Browser with an allowed educational tab -> let it through.
    // (Checked BEFORE the blocked set, because Chrome & co. are blocked.)
    if (pkg in BROWSERS && browserTabAllowed(event)) {
      LockdownOverlayService.hide(this)
      return
    }

    val blocked = (prefs.getString("blocked", "") ?: "")
      .split(",").map { it.trim() }.filter { it.isNotEmpty() }
      .toHashSet()

    val isBlocked = pkg in blocked || (pkg in BROWSERS)
    if (!isBlocked) {
      // App is not on the shield list at all — hide any stale barrier.
      LockdownOverlayService.hide(this)
      return
    }

    // Blocked launch: send HOME and raise the barrier.
    if (System.currentTimeMillis() - lastBlockAt > 2000) {
      lastBlockAt = System.currentTimeMillis()
      performGlobalAction(GLOBAL_ACTION_HOME)
      LockdownOverlayService.show(this)
      // Durable report: JS updates the penalty UI when alive; if the React
      // process was force-quit the watchdog posts it natively instead of
      // losing the violation.
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

  private fun browserTabAllowed(event: AccessibilityEvent): Boolean {
    val hay = (event.text?.joinToString(" ") ?: "").lowercase()
    return BROWSER_ALLOWED.any { hay.contains(it) }
  }

  companion object {
    private var lastBlockAt = 0L
  }
}
