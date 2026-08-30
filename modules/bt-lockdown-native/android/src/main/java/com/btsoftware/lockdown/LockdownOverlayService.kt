package com.btsoftware.lockdown

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.app.admin.DevicePolicyManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * BT LOCKDOWN enforcement service.
 *
 * Two jobs, one process:
 *  1. FULL-SCREEN BARRIER — a real TYPE_APPLICATION_OVERLAY window with the
 *     session countdown. Shown when a blocked app is intercepted (and over
 *     the launcher after HOME), hidden when the student is in a safe app.
 *  2. SESSION WATCHDOG — polls the server while the session is active
 *     (every 5s), heartbeats (every 20s), watches the accessibility
 *     permission, and cleans itself up when the session ends or the token
 *     dies — even if the React process is gone.
 */
class LockdownOverlayService : Service() {

  private val prefs: SharedPreferences by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
  private var wm: WindowManager? = null
  private var overlay: View? = null
  private var countText: TextView? = null

  private val main = Handler(Looper.getMainLooper())
  private lateinit var worker: HandlerThread
  private lateinit var workerH: Handler

  private var lastHeartbeatAt = 0L
  private var netFailCount = 0
  private var firstServerInactiveAt = 0L
  private var lastA11yWarnAt = 0L
  private var lastHeartLostAt = 0L
  private var lastUnauthorizedAt = 0L
  private var lastAdminWarnAt = 0L

  // Adaptive watchdog interval: 5s while the server answers, backing off
  // to 10/20/30s on repeated failures (Tier 2). Resets on the next success.
  private val watchdogInterval: Long
    get() = when {
      netFailCount >= 4 -> 30_000L
      netFailCount >= 2 -> 20_000L
      netFailCount >= 1 -> 10_000L
      else -> 5_000L
    }

  /**
   * Server clock anchor (Tier 1 #2). offsetMs = serverTime - deviceWallClock,
   * refreshed on every watchdog tick. All end-of-session math goes through
   * serverNowMillis(), so a student rewinding the device clock can no longer
   * extend the barrier countdown or delay local expiry.
   */
  private fun serverNowMillis(): Long =
    System.currentTimeMillis() + prefs.getLong("clockOffsetMs", 0L)

  private fun applyServerClock(iso: String) {
    val t = parseIso(iso)
    if (t == 0L) return
    val offset = t - System.currentTimeMillis()
    prefs.edit().putLong("clockOffsetMs", offset).apply()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    ensureChannel()
    wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    worker = HandlerThread("bt-lockdown-watchdog").apply { start() }
    workerH = Handler(worker.looper)
    startForeground(NOTIF_ID, buildNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopEverything()
      ACTION_SHOW -> showOverlay()
      ACTION_HIDE -> hideOverlay()
      else -> if (prefs.getBoolean("active", false)) startWatchdog()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    stopCountdownTick()
    if (::worker.isInitialized) {
      workerH.removeCallbacksAndMessages(null)
      worker.quitSafely()
    }
    removeOverlay()
    super.onDestroy()
  }

  // ------------------------------------------------------------------
  // Full-screen barrier
  // ------------------------------------------------------------------

  private fun showOverlay() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { showOverlay() }
      return
    }
    if (overlay != null) return
    if (!prefs.getBoolean("active", false)) return
    if (!Settings.canDrawOverlays(this)) {
      Bridge.emit("overlayDenied")
      return
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.parseColor("#040405"))
      setPadding(dp(24), dp(40), dp(24), dp(36))
      setOnTouchListener { _, _ -> true } // swallow every touch
    }

    val top = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val brand = TextView(this).apply {
      text = "BT LOCKDOWN"
      setTextColor(Color.parseColor("#FF7A15"))
      textSize = 13f
      setTypeface(typeface, Typeface.BOLD)
    }
    val spacer = View(this).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) }
    val pill = TextView(this).apply {
      text = "  SEALED  "
      setTextColor(Color.parseColor("#040405"))
      setBackgroundColor(Color.parseColor("#2FE6A0"))
      textSize = 11f
      setTypeface(typeface, Typeface.BOLD)
      val p = dp(10)
      setPadding(p, dp(5), p, dp(5))
    }
    top.addView(brand)
    top.addView(spacer)
    top.addView(pill)
    root.addView(top)

    val midGap = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 1, 1f) }
    root.addView(midGap)

    val subject = TextView(this).apply {
      text = prefs.getString("subject", "Study") ?: "Study"
      setTextColor(Color.parseColor("#FF7A15"))
      textSize = 22f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    root.addView(subject)

    countText = TextView(this).apply {
      text = "00:00:00"
      setTextColor(Color.parseColor("#F5F4F0"))
      textSize = 54f
      setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(0, dp(14), 0, dp(14))
    }
    root.addView(countText)

    val note = TextView(this).apply {
      text = "This phone is sealed until the session ends.\nReturn to BT LOCKDOWN to continue studying."
      setTextColor(Color.parseColor("#8A8A93"))
      textSize = 14f
      gravity = Gravity.CENTER
    }
    root.addView(note)

    val midGap2 = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 1, 1f) }
    root.addView(midGap2)

    val foot = TextView(this).apply {
      text = "Deep Work · " + (prefs.getString("title", "Lockdown") ?: "")
      setTextColor(Color.parseColor("#5A5A63"))
      textSize = 11f
      gravity = Gravity.CENTER
    }
    root.addView(foot)

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
      PixelFormat.OPAQUE
    ).apply {
      gravity = Gravity.TOP or Gravity.START
    }

    try {
      wm?.addView(root, params)
      overlay = root
      updateCountdown()
      startCountdownTick()
    } catch (e: Exception) {
      removeOverlay()
      Bridge.emit("overlayDenied")
    }
  }

  private fun hideOverlay() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { hideOverlay() }
      return
    }
    removeOverlay()
  }

  private fun removeOverlay() {
    overlay?.let {
      try { wm?.removeView(it) } catch (_: Throwable) { }
    }
    overlay = null
    countText = null
    stopCountdownTick()
  }

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

  private val countTick = object : Runnable {
    override fun run() {
      if (!prefs.getBoolean("active", false)) {
        stopCountdownTick()
        return
      }
      updateCountdown()
      main.postDelayed(this, 1000)
    }
  }

  private fun startCountdownTick() {
    main.removeCallbacks(countTick)
    main.post(countTick)
  }

  private fun stopCountdownTick() {
    main.removeCallbacks(countTick)
  }

  private fun updateCountdown() {
    val endsAt = prefs.getString("endsAt", "") ?: ""
    val t = parseIso(endsAt)
    // Server-anchored clock: a rewound device clock cannot buy extra time.
    val ms = if (t == 0L) 0L else (t - serverNowMillis()).coerceAtLeast(0L)
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    countText?.text = String.format("%02d:%02d:%02d", h, m, s)
  }

  // ------------------------------------------------------------------
  // Session watchdog (runs even if the React process is dead)
  // ------------------------------------------------------------------

  private val watchdog = object : Runnable {
    override fun run() {
      try { tickWatchdog() } catch (_: Throwable) { }
      if (prefs.getBoolean("active", false)) workerH.postDelayed(this, watchdogInterval)
    }
  }

  private fun startWatchdog() {
    workerH.removeCallbacks(watchdog)
    workerH.post(watchdog)
  }

  private fun tickWatchdog() {
    val active = prefs.getBoolean("active", false)
    if (!active) return

    // 1. Local expiry — compared against the SERVER-anchored clock so a
    //    device clock rewind cannot postpone it.
    val endsAt = parseIso(prefs.getString("endsAt", "") ?: "")
    if (endsAt > 0L && serverNowMillis() >= endsAt) {
      selfCleanup("expired")
      return
    }

    val apiBase = (prefs.getString("apiBase", "") ?: "").trimEnd('/')
    val token = prefs.getString("token", "") ?: ""
    val sessionId = prefs.getString("sessionId", "") ?: ""

    // Flush any violation events queued while JS was dead (force-quit / reboot).
    if (apiBase.isNotEmpty() && token.isNotEmpty()) {
      NativeReporter.flush(this@LockdownOverlayService, apiBase, token)
    }

    // 2. Server check
    if (apiBase.isNotEmpty() && token.isNotEmpty()) {
      val res = httpGet("$apiBase/api/lockdown/current", token)
      when {
        res == null -> {
          netFailCount++
          if (netFailCount >= 5 && SystemClock.elapsedRealtime() - lastHeartLostAt > 5 * 60000) {
            lastHeartLostAt = SystemClock.elapsedRealtime()
            Bridge.emit("heartbeatLost")
          }
        }
        res.status == 401 || res.status == 403 -> {
          if (SystemClock.elapsedRealtime() - lastUnauthorizedAt > 30000) {
            lastUnauthorizedAt = SystemClock.elapsedRealtime()
            Bridge.emit("unauthorized")
          }
          if (!Bridge.jsAlive() && (firstServerInactiveAt == 0L ||
              SystemClock.elapsedRealtime() - firstServerInactiveAt > GRACE_MS)) {
            selfCleanup("unauthorized")
          }
          return
        }
        else -> {
          netFailCount = 0
          val body = try { JSONObject(res.body) } catch (_: Throwable) { null }
          if (body != null) {
            body.optString("server_time", "").let { if (it.isNotEmpty()) applyServerClock(it) }
            val serverEnds = body.optString("end_time", "")
            if (serverEnds.isNotEmpty() && serverEnds != prefs.getString("endsAt", "")) {
              val t = parseIso(serverEnds)
              if (t > 0L) prefs.edit().putString("endsAt", serverEnds).apply()
            }
            val serverActive = body.optBoolean("active", false)
            if (!serverActive) {
              if (firstServerInactiveAt == 0L) firstServerInactiveAt = SystemClock.elapsedRealtime()
              hideOverlay()
              Bridge.emit("serverInactive")
              // JS should disarm now. If it never comes back, clean up after a grace period.
              if (!Bridge.jsAlive() && SystemClock.elapsedRealtime() - firstServerInactiveAt > GRACE_MS) {
                selfCleanup("serverInactive")
                return
              }
            } else {
              firstServerInactiveAt = 0L
            }
          }
        }
      }

      // 3. Heartbeat every 20s. Intervals use elapsedRealtime so wall-clock
      //    changes (student rewinding time) cannot slow the heartbeat cadence.
      //    client_time is the TRUE device wall clock — the server compares it
      //    against its own UTC clock to detect manipulation.
      if (SystemClock.elapsedRealtime() - lastHeartbeatAt > 20000 && sessionId.isNotEmpty()) {
        lastHeartbeatAt = SystemClock.elapsedRealtime()
        httpPost(
          "$apiBase/api/lockdown/heartbeat", token,
          """{"session_id":"$sessionId","client_time":"${nowIsoUtc()}"}"""
        )
      }
    }

    // 4. Accessibility permission watchdog (throttled ~60s between reports)
    if (SystemClock.elapsedRealtime() - lastA11yWarnAt > 60_000) {
      val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager
      val list = am.getEnabledAccessibilityServiceList(
        android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
      )
      val me = android.content.ComponentName(this, LockdownAccessibilityService::class.java).flattenToString()
      val on = list.any {
        it.resolveInfo.serviceInfo.let { s ->
          android.content.ComponentName(s.packageName, s.name).flattenToString()
        } == me
      }
      if (!on) {
        lastA11yWarnAt = SystemClock.elapsedRealtime()
        // Durable: recorded even if JS was force-quit.
        NativeReporter.report(
          this, "accessibilityOff", "tamper_detected",
          "The accessibility (seal) service was switched off during a sealed session."
        )
      }
    }

    // 5. Device-admin tripwire (Tier 1 #6): if the admin was granted at
    //    activation, it must still be set. Removing it mid-session is tamper.
    val adminWasActive = prefs.getBoolean("adminActive", false)
    if (adminWasActive && SystemClock.elapsedRealtime() - lastAdminWarnAt > 60_000) {
      val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
      val adminStill = dpm?.isAdminActive(
        android.content.ComponentName(this, LockdownAdminReceiver::class.java)
      ) ?: false
      if (!adminStill) {
        lastAdminWarnAt = SystemClock.elapsedRealtime()
        prefs.edit().putBoolean("adminActive", false).apply()
        NativeReporter.report(
          this, "adminDisabled", "tamper_detected",
          "Device admin was removed during a sealed Deep Work session."
        )
      }
    }
  }

  /** Called by JS on disarm (session completed / abandoned / sign-out). */
  private fun stopEverything() {
    prefs.edit().putBoolean("active", false).apply()
    if (Looper.myLooper() != Looper.getMainLooper()) main.post { removeOverlay() } else removeOverlay()
    workerH.removeCallbacks(watchdog)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
      else stopForeground(true)
    } catch (_: Throwable) { }
    stopSelf()
  }

  /** Watchdog detected the session is over server-side (or the token died). */
  private fun selfCleanup(reason: String) {
    Bridge.emit(reason)
    prefs.edit().putBoolean("active", false).apply()
    main.post { removeOverlay() }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
      else stopForeground(true)
    } catch (_: Throwable) { }
    stopSelf()
  }

  // ------------------------------------------------------------------
  // Minimal HTTP (no extra dependencies)
  // ------------------------------------------------------------------

  private class HttpRes(val status: Int, val body: String)

  private fun open(url: String, token: String, method: String, body: String?): HttpURLConnection {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 8000
    c.readTimeout = 8000
    c.requestMethod = method
    c.setRequestProperty("Authorization", "Bearer $token")
    c.setRequestProperty("Accept", "application/json")
    if (body != null) {
      c.doOutput = true
      c.setRequestProperty("Content-Type", "application/json")
      c.outputStream.use { it.write(body.toByteArray()) }
    }
    return c
  }

  private fun httpGet(url: String, token: String): HttpRes? {
    return try {
      val c = open(url, token, "GET", null)
      val code = c.responseCode
      val text = (if (code >= 200 && code < 300) c.inputStream else c.errorStream)
        ?.bufferedReader()?.use { it.readText() } ?: ""
      c.disconnect()
      HttpRes(code, text)
    } catch (_: Throwable) {
      null
    }
  }

  private fun httpPost(url: String, token: String, body: String): HttpRes? {
    return try {
      val c = open(url, token, "POST", body)
      val code = c.responseCode
      val text = (if (code >= 200 && code < 300) c.inputStream else c.errorStream)
        ?.bufferedReader()?.use { it.readText() } ?: ""
      c.disconnect()
      HttpRes(code, text)
    } catch (_: Throwable) {
      null
    }
  }

  // ------------------------------------------------------------------
  // Misc
  // ------------------------------------------------------------------

  private fun parseIso(value: String): Long {
    // Naive server timestamps are UTC. No java.time — works on all min SDKs.
    if (value.isBlank()) return 0L
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

  private fun nowIsoUtc(): String {
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply {
      timeZone = java.util.TimeZone.getTimeZone("UTC")
    }
    return fmt.format(java.util.Date())
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(NotificationManager::class.java)
    if (mgr.getNotificationChannel(CHANNEL) == null) {
      mgr.createNotificationChannel(
        NotificationChannel(CHANNEL, "BT LOCKDOWN", NotificationManager.IMPORTANCE_LOW)
      )
    }
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
      .setCategory(Notification.CATEGORY_SERVICE)
      .let { b ->
        val launch = try {
          packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        } catch (_: Throwable) { null }
        if (launch != null) {
          b.setContentIntent(
            android.app.PendingIntent.getActivity(
              this, 0, launch, android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )
          )
        }
        b
      }
      .build()
  }

  companion object {
    const val PREFS = "bt.lockdown"
    private const val CHANNEL = "bt_lockdown"
    private const val NOTIF_ID = 4401
    private const val ACTION_STOP = "com.btsoftware.lockdown.STOP"
    const val ACTION_SHOW = "com.btsoftware.lockdown.SHOW"
    const val ACTION_HIDE = "com.btsoftware.lockdown.HIDE"
    private const val GRACE_MS = 90_000L

    @Volatile
    var running = false

    fun start(ctx: Context) {
      val i = Intent(ctx, LockdownOverlayService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
        else ctx.startService(i)
      } catch (_: Throwable) {
        // background start restricted (Android 12+); service may already be running
        try { ctx.startService(i) } catch (_: Throwable) { }
      }
    }

    fun show(ctx: Context) {
      send(ctx, ACTION_SHOW)
    }

    fun hide(ctx: Context) {
      send(ctx, ACTION_HIDE)
    }

    fun stop(ctx: Context) {
      val i = Intent(ctx, LockdownOverlayService::class.java).setAction(ACTION_STOP)
      try { ctx.startService(i) } catch (_: Throwable) {
        prefsClear(ctx)
      }
    }

    private fun send(ctx: Context, action: String) {
      if (running) {
        val i = Intent(ctx, LockdownOverlayService::class.java).setAction(action)
        try { ctx.startService(i) } catch (_: Throwable) { }
      } else {
        // Service is not running: start it (default action boots the watchdog),
        // then deliver the show/hide intent — Android queues both in order.
        start(ctx)
        val i = Intent(ctx, LockdownOverlayService::class.java).setAction(action)
        try { ctx.startService(i) } catch (_: Throwable) { }
      }
    }

    private fun prefsClear(ctx: Context) {
      try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit().putBoolean("active", false).apply()
      } catch (_: Throwable) { }
    }
  }
}
