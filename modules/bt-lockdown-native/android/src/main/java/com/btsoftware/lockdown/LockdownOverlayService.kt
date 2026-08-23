package com.btsoftware.lockdown

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Sticky foreground service so MIUI / OEM killers cannot silently
 * drop the lockdown process. The visible UI is the React Native
 * lockdown screen; this service is the keep-alive.
 */
class LockdownOverlayService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
    startForeground(NOTIF_ID, buildNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    return START_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(NotificationManager::class.java)
    mgr.createNotificationChannel(
      NotificationChannel(CHANNEL, "BT LOCKDOWN", NotificationManager.IMPORTANCE_LOW)
    )
  }

  private fun buildNotification(): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
      else Notification.Builder(this)
    return builder
      .setContentTitle("BT LOCKDOWN")
      .setContentText("Deep Work is sealed. Distracting apps are intercepted.")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val CHANNEL = "bt_lockdown"
    private const val NOTIF_ID = 4401
    private const val ACTION_STOP = "com.btsoftware.lockdown.STOP"

    fun start(ctx: Context) {
      val i = Intent(ctx, LockdownOverlayService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
      else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.startService(Intent(ctx, LockdownOverlayService::class.java).setAction(ACTION_STOP))
    }
  }
}
