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
 *
 * Android 15/16 note: the watchdog uses the specialUse foreground service
 * type, which is NOT on the BOOT_COMPLETED launch-ban list (dataSync,
 * camera, mediaPlayback, phoneCall, mediaProjection, microphone). With
 * dataSync, a reboot mid-session on Android 15+ would throw
 * ForegroundServiceStartNotAllowedException and the seal would silently
 * die until the student reopened the app.
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
    // Always restart the keep-alive watchdog after boot so the app can
    // auto-activate on the AI timetable without the student reopening it. The
    // idle watchdog self-arms when the server reports an active session, and it
    // also resumes enforcing if a session was already active when the phone
    // rebooted (the service re-reads prefs on start).
    LockdownOverlayService.startIdle(context)
  }
}
