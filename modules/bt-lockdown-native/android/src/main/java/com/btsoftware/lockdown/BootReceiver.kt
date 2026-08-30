package com.btsoftware.lockdown

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reboot hole (Tier 1 #1).
 *
 * Before this receiver a phone restarted mid-session came up unsealed:
 * the accessibility service only *observes* launches and the watchdog
 * foreground service was gone until the student happened to reopen the
 * app. On BOOT_COMPLETED (and the OEM quick-boot variants) we check
 * prefs.active: if a session is still armed we relaunch the watchdog
 * service, which re-reads every session detail from prefs and resumes
 * enforcement. The watchdog itself talks to the server, so an expired
 * or server-ended session self-cleans within a few seconds — booting
 * with a stale "active" flag is safe.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != "android.intent.action.QUICKBOOT_POWERON" &&
      action != "com.htc.intent.action.QUICKBOOT_POWERON"
    ) {
      return
    }
    val active = context.getSharedPreferences(LockdownOverlayService.PREFS, Context.MODE_PRIVATE)
      .getBoolean("active", false)
    if (active) {
      LockdownOverlayService.start(context)
    }
  }
}
