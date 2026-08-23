package com.btsoftware.lockdown

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.content.Context

/**
 * Real-time launch interceptor.
 * Tuned for MIUI / Redmi: we listen to TYPE_WINDOW_STATE_CHANGED and
 * also TYPE_WINDOWS_CHANGED because some OEM launchers skip the first.
 *
 * If a blocked package comes to the foreground during an active session
 * we send the user HOME and raise the BT LOCKDOWN overlay.
 */
class LockdownAccessibilityService : AccessibilityService() {

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (
      event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED
    ) return

    val pkg = event.packageName?.toString() ?: return
    val prefs = getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
    if (!prefs.getBoolean("active", false)) return

    val whitelist = prefs.getString("whitelist", "")!!
      .split(",").map { it.trim() }.filter { it.isNotEmpty() }
      .toHashSet()
      .also {
        it.add(packageName)
        it.add("com.android.systemui")
        it.add("com.miui.home")
        it.add("com.android.phone")
        it.add("com.google.android.dialer")
        it.add("com.android.incallui")
      }

    val blocked = prefs.getString("blocked", "")!!
      .split(",").map { it.trim() }.filter { it.isNotEmpty() }
      .toHashSet()

    val isBlocked = blocked.contains(pkg) || (!whitelist.contains(pkg) && looksLikeBrowserTab(event, pkg))
    if (!isBlocked) return
    if (whitelist.contains(pkg)) return

    performGlobalAction(GLOBAL_ACTION_HOME)
    LockdownOverlayService.start(this)
  }

  override fun onInterrupt() = Unit

  override fun onServiceConnected() {
    super.onServiceConnected()
  }

  private fun looksLikeBrowserTab(event: AccessibilityEvent, pkg: String): Boolean {
    val browsers = setOf(
      "com.android.chrome",
      "com.chrome.beta",
      "org.mozilla.firefox",
      "com.microsoft.emmx",
      "com.opera.browser",
      "com.sec.android.app.sbrowser",
      "com.mi.globalbrowser",
    )
    if (!browsers.contains(pkg)) return false
    val hay = (event.text?.joinToString(" ") ?: "").lowercase()
    val allowed = listOf("bt learning", "btlearning", "youtube.com/watch", "khanacademy", "coursera")
    return allowed.none { hay.contains(it) }
  }
}
