package com.btsoftware.lockdown

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Doze-resilient keep-alive tick.
 *
 * Why a foreground service needs an alarm behind it: the watchdog FGS is what
 * keeps enforcement + sync running, and a started FGS is normally only killed
 * under memory pressure or an OEM "cleaner". When that happens the
 * [START_STICKY] restart is the recovery path, but while the device is idle in
 * Doze the restart can be deferred, and nothing else wakes the app until the
 * student opens it. On Android 15+ an `exact` alarm would need
 * SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM (a Play-restricted permission, and the
 * wrong reason to hold one), so this uses `setAndAllowWhileIdle`: inexact,
 * allowed to fire in Doze and light idle, and it costs one wake-up per
 * [TICK_MS] rather than a hammering loop.
 *
 * On each tick we (a) make sure the watchdog is alive at all and (b) run one
 * enforcement pass so the network shield and the seal state are re-verified
 * even if the 5 s loop is gone. The next tick is scheduled *before* doing the
 * work, so a failing pass never breaks the chain.
 *
 * This is a documented keep-alive mechanism, not a persistence trick: force-stop
 * cancels it (as Android intends), uninstall stops it, and it carries no
 * attempt to evade the OS's own controls.
 */
class WatchdogAlarmReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_TICK) return
    try {
      scheduleNext(context)
    } catch (_: Throwable) { }
    try {
      if (!LockdownOverlayService.running) {
        LockdownOverlayService.startIdle(context)
      } else {
        LockdownOverlayService.ensureProtectionNow(context)
      }
    } catch (_: Throwable) { }
  }

  companion object {
    private const val ACTION_TICK = "com.btsoftware.lockdown.WATCHDOG_TICK"
    private const val REQUEST_CODE = 4402
    /** 15 min: Doze already coalesces these, and the FGS loop is the fast path. */
    private const val TICK_MS = 15 * 60 * 1000L

    fun scheduleNext(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
      val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      try {
        am.setAndAllowWhileIdle(
          AlarmManager.RTC_WAKEUP,
          System.currentTimeMillis() + TICK_MS,
          pendingIntent(ctx)
        )
      } catch (_: Throwable) { }
    }

    fun cancel(ctx: Context) {
      val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      try {
        am.cancel(pendingIntent(ctx))
      } catch (_: Throwable) { }
    }

    private fun pendingIntent(ctx: Context): PendingIntent {
      val i = Intent(ctx, WatchdogAlarmReceiver::class.java).setAction(ACTION_TICK)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_IMMUTABLE else 0)
      return PendingIntent.getBroadcast(ctx, REQUEST_CODE, i, flags)
    }
  }
}
