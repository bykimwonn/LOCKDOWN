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
import android.content.pm.ServiceInfo
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

  // Corner countdown chip. A tiny non-blocking overlay in the top-right that
  // shows "3 min to lockdown" during the pre-warning window and then the live
  // remaining time while a session is active — so the student always has a
  // clock even when the full-screen barrier is not up (safe app).
  private var cornerView: View? = null
  private var cornerText: TextView? = null
  private var cornerTargetAt = 0L // epoch ms (server-anchored when available)

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
  private var lastNotifRefreshAt = 0L

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
    startForegroundTyped()
    // Sub-second detection of the student (or an OEM) flipping the seal service
    // off, instead of noticing on the next 60 s poll.
    AccessibilityHealth.watch(this, workerH, { workerH.post { a11yLost("observer") } },
      { workerH.post { a11yRestored() } })
  }

  /**
   * Android 14+ requires the foreground service type to be declared in the
   * manifest AND passed to startForeground(). We use specialUse (see
   * plugins/withBTLockdown.js): unlike dataSync it has no Android 15 six-hour
   * cap and is allowed to start from BOOT_COMPLETED on Android 15/16, so the
   * watchdog survives reboots and long sessions. On older Android the plain
   * two-arg call is used (the type constant does not exist below API 34).
   */
  private fun startForegroundTyped() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, buildNotification())
    }
  }

  /**
   * Android 15 (API 35): the system may call onTimeout() for time-limited FGS
   * types (dataSync / mediaProcessing). specialUse is NOT time-limited, but
   * having this override means a future switch back to dataSync (or an OEM
   * compat flag) degrades gracefully instead of throwing an internal ANR
   * exception. The method never exists/invokes below API 35.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
      else @Suppress("DEPRECATION") stopForeground(true)
    } catch (_: Throwable) { }
    stopSelf()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopEverything()
      ACTION_SHOW -> showOverlay()
      ACTION_HIDE -> hideOverlay()
      ACTION_CORNER -> {
        // JS tells us when to show the 3-minute corner countdown.
        cornerTargetAt = intent.getLongExtra("targetAt", 0L)
        showCorner()
      }
      ACTION_CORNER_OFF -> hideCorner()
      ACTION_IDLE -> startIdleWatchdog()
      ACTION_ENFORCE -> workerH.post {
        // One immediate verification/repair pass (asked for by the accessibility
        // service, the VPN service or a settings change) instead of waiting for
        // the next tick.
        try { enforceLayers() } catch (_: Throwable) { }
      }
      ACTION_NOTIF -> updateOngoingNotification()
      // Null intent == the system restarted us (START_STICKY after a kill). Re-read
      // the session from prefs and, when nothing is armed, keep the idle loop
      // running: before this a restarted service stayed alive but ticked nothing,
      // so auto-activation was dead until the app was opened again.
      else -> if (prefs.getBoolean("active", false)) startWatchdog() else startIdleWatchdog()
    }
    // Keep-alive for the Doze case: an inexact-but-idle-allowed alarm (no exact
    // alarm permission needed) re-checks us every 15 min. See WatchdogAlarmReceiver.
    WatchdogAlarmReceiver.scheduleNext(this)
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    AccessibilityHealth.unwatch(this)
    stopCountdownTick()
    if (::worker.isInitialized) {
      workerH.removeCallbacksAndMessages(null)
      worker.quitSafely()
    }
    removeOverlay()
    super.onDestroy()
  }

  /**
   * Recents-swipe resilience (Xiaomi/MIUI especially): swiping the app away
   * kills the whole process group on many OEMs even for sticky foreground
   * services — taking the always-on notification and the keep-alive watchdog
   * with it. Re-launch immediately; the service re-reads every session detail
   * from prefs on start, so this is cheap and always safe (an expired or
   * server-ended session self-cleans within seconds of coming back).
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    try {
      start(applicationContext)
    } catch (_: Throwable) { }
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
      // Hide the status bar + gesture nav while sealed so a student cannot
      // pull the notification shade / recents over the barrier to reach
      // Settings and disable accessibility. FLAG_SECURE also blocks
      // screenshots / screen-recording of the seal.
      systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        or View.SYSTEM_UI_FLAG_FULLSCREEN
        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
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
      text = "Protected against distractions by BT LOCKDOWN.\nThis phone is sealed until the session ends.\nTap below to return to BT LOCKDOWN."
      setTextColor(Color.parseColor("#8A8A93"))
      textSize = 14f
      gravity = Gravity.CENTER
    }
    root.addView(note)

    // A real, always-reachable return path. The barrier is touch-modal, so the
    // student can no longer tap the launcher to get back to the app; this is the
    // one way in. Launching our own package is always allowed (it is the safe
    // zone in the accessibility service).
    val returnBtn = TextView(this).apply {
      text = "OPEN BT LOCKDOWN"
      setTextColor(Color.parseColor("#0A0A0B"))
      setBackgroundColor(Color.parseColor("#FF7A15"))
      textSize = 15f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
      isClickable = true
      setPadding(dp(22), dp(12), dp(22), dp(12))
      setOnClickListener {
        try {
          val launch = packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(
              Intent.FLAG_ACTIVITY_NEW_TASK
                or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                or Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
          if (launch != null) startActivity(launch)
        } catch (_: Throwable) { }
      }
    }
    val btnHolder = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setPadding(0, dp(6), 0, 0)
    }
    btnHolder.addView(returnBtn)
    root.addView(btnHolder)

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
        or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        or WindowManager.LayoutParams.FLAG_SECURE
        or WindowManager.LayoutParams.FLAG_FULLSCREEN,
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
  // Corner countdown chip (pre-warning + in-session clock)
  // ------------------------------------------------------------------

  private fun showCorner() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { showCorner() }
      return
    }
    if (cornerView != null) { updateCorner(); return }
    if (!Settings.canDrawOverlays(this)) {
      Bridge.emit("overlayDenied")
      return
    }
    val chip = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setBackgroundColor(Color.parseColor("#CC0A0B0E"))
      setPadding(dp(12), dp(6), dp(12), dp(6))
      setOnTouchListener { _, _ -> true } // swallow, not interactive
    }
    cornerText = TextView(this).apply {
      text = ""
      setTextColor(Color.parseColor("#FF7A18"))
      textSize = 13f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    chip.addView(cornerText)

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      y = dp(50) // below the status bar
      x = dp(14)
    }
    try {
      wm?.addView(chip, params)
      cornerView = chip
      updateCorner()
      startCornerTick()
    } catch (_: Throwable) {
      cornerView = null
      cornerText = null
    }
  }

  private fun hideCorner() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { hideCorner() }
      return
    }
    cornerTargetAt = 0L
    cornerView?.let { try { wm?.removeView(it) } catch (_: Throwable) { } }
    cornerView = null
    cornerText = null
    stopCornerTick()
  }

  private val cornerTick = object : Runnable {
    override fun run() {
      updateCorner()
      main.postDelayed(this, 1000)
    }
  }
  private fun startCornerTick() {
    main.removeCallbacks(cornerTick)
    main.post(cornerTick)
  }
  private fun stopCornerTick() {
    main.removeCallbacks(cornerTick)
  }

  private fun updateCorner() {
    // Pre-warning window: count down to a session that has NOT started yet.
    // In-session: count down to the session end (prefs.endsAt).
    var target = cornerTargetAt
    var prefix = "SEAL IN "
    if (prefs.getBoolean("active", false)) {
      target = parseIso(prefs.getString("endsAt", "") ?: "")
      prefix = ""
    }
    if (target <= 0L) { hideCorner(); return }
    val ms = (target - serverNowMillis()).coerceAtLeast(0L)
    val total = ms / 1000
    val mm = total / 60
    val ss = total % 60
    cornerText?.text = prefix + String.format("%02d:%02d", mm, ss)
    // If the pre-warning target has passed and the session isn't armed yet,
    // hide the chip (the full-screen barrier takes over).
    if (cornerTargetAt > 0L && ms <= 0L && !prefs.getBoolean("active", false)) {
      hideCorner()
    }
  }

  // ------------------------------------------------------------------
  // Idle keep-alive watchdog
  // ------------------------------------------------------------------

  private val idleWatchdog = object : Runnable {
    override fun run() {
      try { tickIdle() } catch (_: Throwable) { }
      workerH.postDelayed(this, IDLE_TICK_MS)
    }
  }

  private fun startIdleWatchdog() {
    workerH.removeCallbacks(watchdog)
    workerH.removeCallbacks(idleWatchdog)
    workerH.post(idleWatchdog)
  }

  private fun tickIdle() {
    // The seal-health prompt is evaluated on the idle path too, BEFORE anything can
    // return early: "accessibility quietly turned itself off" is exactly the case
    // where there may be no token, no session and no JS running to notice it.
    try { syncSealAlert("idle") } catch (_: Throwable) { }
    // Already enforcing — the active watchdog takes over.
    if (prefs.getBoolean("active", false)) {
      startWatchdog()
      return
    }
    val apiBase = (prefs.getString("apiBase", "") ?: "").trimEnd('/')
    val token = prefs.getString("token", "") ?: ""
    if (apiBase.isEmpty() || token.isEmpty()) return
    // Self-arm from the timetable: if the server says a session is active for
    // this device and we are not already enforcing, arm it. This is what makes
    // auto-activation work even when JS has not run the 4s sync loop.
    val res = httpGet("$apiBase/api/lockdown/current", token)
    if (res == null) return
    if (res.status == 401 || res.status == 403) {
      Bridge.emit("unauthorized")
      return
    }
    val body = try { JSONObject(res.body) } catch (_: Throwable) { null } ?: return
    body.optString("server_time", "").let { if (it.isNotEmpty()) applyServerClock(it) }
    val active = body.optBoolean("active", false)
    val sessionId = body.optString("session_id", "")
    // Only auto-arm if the accessibility service is actually on — otherwise the
    // session would flip to "active" yet still not intercept anything.
    if (active && sessionId.isNotEmpty() && !prefs.getBoolean("active", false) && isAccessibilityOn()) {
      val endsAt = body.optString("end_time", "")
      if (endsAt.isNotEmpty()) {
        val t = parseIso(endsAt)
        if (t > 0L) prefs.edit().putString("endsAt", endsAt).apply()
      }
      val subject = body.optString("subject", "")
      val title = if (subject.isNotEmpty()) "Deep Work · $subject" else "Deep Work"
      prefs.edit()
        .putBoolean("active", true)
        .putString("sessionId", sessionId)
        .putString("subject", subject)
        .putString("title", title)
        .apply()
      showOverlay()
      // A session armed without the React layer (reboot mid-session, timetable
      // auto-lock) must still get the network shield — this path is exactly where
      // accessibility may already be gone.
      NetworkProtectionManager.onSessionArmed(this@LockdownOverlayService)
      startWatchdog()
    }
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
    // Flip the always-on notification into its SEALED form immediately.
    updateOngoingNotification()
  }

  private fun tickWatchdog() {
    val active = prefs.getBoolean("active", false)
    if (!active) return

    // Keep the always-on notification's sealed end-time fresh (throttled 30s).
    if (SystemClock.elapsedRealtime() - lastNotifRefreshAt > 30_000) {
      lastNotifRefreshAt = SystemClock.elapsedRealtime()
      updateOngoingNotification()
    }

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
          // Proof that the shield did not cut our own control channel (it must
          // not: our package is excluded from the tunnel). NetworkProtectionManager
          // treats "no accepted round-trip while the tunnel is up" as DEGRADED.
          if (res.status in 200..299) NetworkProtectionManager.noteControlChannel(this@LockdownOverlayService)
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

    // 4. Seal health. Three signals, because each one alone lies:
    //    - the Settings.Secure list (authoritative for binding, but stale on
    //      MIUI right after a toggle — the classic false "accessibility off"),
    //    - our own bound flag + event heartbeat (proof callbacks are flowing),
    //    - the ContentObserver edge (sub-second, so the escape window is tiny).
    //    "Listed but not bound" = the OEM killed our process: diagnostic only,
    //    never a penalty, because the student did not do it.
    AccessibilityHealth.evaluate(this, { a11yLost("poll") }, { a11yRestored() })
    if (isAccessibilityOn() && !LockdownAccessibilityService.connected) {
      AccessibilityHealth.noteProcessLost(this)
    }
    if (SystemClock.elapsedRealtime() - lastA11yWarnAt > 60_000 && !AccessibilityHealth.isEnforcing(this)) {
      lastA11yWarnAt = SystemClock.elapsedRealtime()
      a11yLost("watchdog")
    }

    // 5. NETWORK SHIELD — verify / repair / report. Independent of the seal:
    //    routing is enforced by the kernel, and on a device-owner device by the
    //    OS's own always-on VPN policy, so it keeps holding when accessibility is
    //    gone and even when this process dies mid-session.
    try { enforceLayers() } catch (_: Throwable) { }

    // 6. Device-admin tripwire (Tier 1 #6): if the admin was granted at
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

  /**
   * Run both protection layers once. Kept tiny so it is safe to call from a
   * settings-change callback as well as from the 5 s tick.
   */
  private fun enforceLayers() {
    NetworkProtectionManager.ensure(this)
    // The notification is refreshed by the 30 s throttle in the tick and directly
    // by the VPN callbacks — no need to notify() on every 5 s pass.
  }

  /**
   * The seal layer went away mid-session. Two things happen at once: the phone
   * hard-seals (without the interceptor we cannot tell a safe app from a blocked
   * one, so the only safe decision is to lock the whole device) and the network
   * shield is engaged, so "turn accessibility off" no longer reopens social
   * media. Reported durably — recorded even if the React process is dead.
   */
  private fun a11yLost(why: String) {
    if (!prefs.getBoolean("active", false)) return
    lastA11yWarnAt = SystemClock.elapsedRealtime()
    NativeReporter.report(
      this, "accessibilityOff", "tamper_detected",
      "The accessibility (seal) service was switched off during a sealed session ($why)."
    )
    main.post { if (overlay == null) showOverlay() }
    try { NetworkProtectionManager.ensure(this) } catch (_: Throwable) { }
    updateOngoingNotification()
    // Also raise the dismissible alert: mid-session the ongoing notification says
    // "seal service OFF", but the student may be inside another app and never see it.
    try { syncSealAlert(why) } catch (_: Throwable) { }
  }

  /** The seal came back (system rebind or re-grant): stop alarming, keep sealing. */
  private fun a11yRestored() {
    Bridge.emit("a11yRestored")
    updateOngoingNotification()
    // The prompt is about a problem that no longer exists: it goes away by itself,
    // with nothing for the student to remember to clear.
    try { syncSealAlert("restored") } catch (_: Throwable) { }
  }

  /** Called by JS on disarm (session completed / abandoned / sign-out). */
  private fun stopEverything() {
    prefs.edit().putBoolean("active", false).apply()
    if (Looper.myLooper() != Looper.getMainLooper()) main.post { removeOverlay() } else removeOverlay()
    main.post { hideCorner() }
    workerH.removeCallbacks(watchdog)
    // The student gets their Internet back the moment the seal goes away. This
    // also clears the device-owner always-on VPN + user restriction we hold.
    try { NetworkProtectionManager.release(this, "disarmed") } catch (_: Throwable) { }
    // Re-arm the idle watchdog so the keep-alive + auto-activation continues
    // between sessions (the student must NOT have to reopen the app).
    startIdleWatchdog()
    updateOngoingNotification()
  }

  /** Watchdog detected the session is over server-side (or the token died). */
  private fun selfCleanup(reason: String) {
    Bridge.emit(reason)
    prefs.edit().putBoolean("active", false).apply()
    main.post { removeOverlay() }
    main.post { hideCorner() }
    // Never keep a student offline after the session ended on the server: this is
    // the remote kill switch path (teacher ends Deep Work in BT LEARNING).
    try { NetworkProtectionManager.release(this, reason) } catch (_: Throwable) { }
    startIdleWatchdog()
    updateOngoingNotification()
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

  /**
   * Robust "is our seal service actually ON" check. MIUI/HyperOS can leave
   * the AccessibilityManager list stale right after the toggle — the app
   * then claims accessibility is off while it is visibly ON. Cross-check
   * the authoritative Settings.Secure ENABLED_ACCESSIBILITY_SERVICES string
   * and match by package + class suffix (short vs long flattening differs
   * across OEMs). Mirrors BTLockdownModule.isAccessibilityEnabled().
   */
  private fun isAccessibilityOn(): Boolean {
    val pkg = packageName
    val cls = "LockdownAccessibilityService"
    try {
      val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager
      val list = am.getEnabledAccessibilityServiceList(
        android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
      )
      val hit = list.any { info ->
        val si = info.resolveInfo.serviceInfo
        si.packageName == pkg && si.name.substringAfterLast('.') == cls
      }
      if (hit) return true
    } catch (_: Throwable) { }
    return try {
      val enabled = android.provider.Settings.Secure.getString(
        contentResolver,
        android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      )
      if (enabled.isNullOrEmpty()) {
        false
      } else {
        val cn = android.content.ComponentName(this, LockdownAccessibilityService::class.java)
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

  /** Device-local HH:mm for the sealed notification's "ends at" text. */
  private fun formatClockHm(epochMs: Long): String {
    return try {
      val fmt = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).apply {
        timeZone = java.util.TimeZone.getDefault()
      }
      fmt.format(java.util.Date(epochMs))
    } catch (_: Throwable) {
      ""
    }
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
    // The separate ALERT channel exists because the ongoing one is IMPORTANCE_LOW
    // on purpose (a permanent notification must never beep all day). A seal that
    // died is a one-off event and deserves a heads-up, so it gets its own channel
    // and its own id, and can be dismissed without touching the ongoing one.
    if (mgr.getNotificationChannel(ALERT_CHANNEL) == null) {
      val c = NotificationChannel(
        ALERT_CHANNEL, "Seal problems", NotificationManager.IMPORTANCE_HIGH
      )
      c.description = "Tells you when the BT LOCKDOWN seal service has been switched off on this phone."
      c.enableVibration(true)
      mgr.createNotificationChannel(c)
    }
  }

  private fun buildNotification(): Notification {
    val sealed = prefs.getBoolean("active", false)
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
      else Notification.Builder(this)
    // Report the state the HEALTH CONTROLLER verified, not "a service is
    // running". Both layers are independent, so the notification says which one
    // is actually holding: accessibility intercepts launches, the network shield
    // takes the Internet away, FULL means both were verified this tick.
    val level = NetworkProtectionManager.protectionLevel(this)
    val net = NetworkProtectionManager.statusLine(this)
    val shieldOn = NetworkProtectionManager.mode(this) != NetworkProtectionManager.MODE_OFF
    val endsAt = parseIso(prefs.getString("endsAt", "") ?: "")
    val hm = if (endsAt > 0L) formatClockHm(endsAt) else ""
    val title: String
    val text: String
    var degraded = false
    if (sealed) {
      when (level) {
        "FULL" -> {
          title = "BT LOCKDOWN — Full Protection"
          text = if (hm.isNotEmpty()) {
            "Apps intercepted + internet blocked · ends at $hm."
          } else {
            "Apps intercepted + internet blocked."
          }
        }
        "SEAL_ONLY" -> {
          title = "BT LOCKDOWN — Sealed"
          text = if (hm.isNotEmpty()) {
            "Distracting apps intercepted · ends at $hm. Internet not blocked (shield $net)."
          } else {
            "Distracting apps intercepted. Internet not blocked (shield $net)."
          }
        }
        "NETWORK_ONLY" -> {
          degraded = true
          title = "BT LOCKDOWN — seal service OFF"
          text = "Device locked and $net. Tap to re-enable the seal service."
        }
        else -> {
          degraded = true
          title = "BT LOCKDOWN — PROTECTION DOWN"
          text = "Neither layer is working. The device stays locked until the session ends."
        }
      }
    } else if (shieldOn) {
      // The shield is armed for the next session: say so instead of implying it
      // is blocking now.
      title = "BT LOCKDOWN is ready"
      text = "Network shield armed ($net) · auto-locks on your timetable."
    } else {
      // The always-on reassurance the student / parent looks for: BT LOCKDOWN
      // is alive and will auto-seal on the AI timetable.
      title = "BT LOCKDOWN is running"
      text = "Protection active — auto-locks on your AI timetable. Tap to open."
    }
    if (degraded && sealed) {
      // A visible, one-tap route for the student / parent / teacher to put the
      // seal back on. We never write the setting ourselves: re-granting
      // accessibility is the user's decision, and that is a line worth keeping.
      try {
        val a11y = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        builder.addAction(
          android.R.drawable.ic_lock_idle_alarm,
          "Re-enable seal",
          android.app.PendingIntent.getActivity(
            this, 0, a11y,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
          )
        )
      } catch (_: Throwable) { }
    }
    return builder
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(android.app.Notification.BigTextStyle().setBigContentTitle(title).setSummaryText(text))
      .setSmallIcon(
        when {
          degraded -> android.R.drawable.ic_lock_idle_alarm
          sealed -> android.R.drawable.ic_lock_lock
          else -> android.R.drawable.ic_lock_idle_lock
        }
      )
      .setOngoing(true)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .let { b ->
        val launch = try {
          packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        } catch (_: Throwable) { null }
        if (launch != null) {
          b.setContentIntent(
            android.app.PendingIntent.getActivity(
              this, 0, launch,
              android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
          )
        }
        b
      }
      .build()
  }

  /**
   * Keep the "seal service is off" alert in sync with reality — posted once per
   * problem, cleared the moment the seal works again.
   *
   * Cadence rules that make this feel solid instead of naggy:
   *  - it is silent until the seal has either been enabled once on this phone or a
   *    session is actually running, so a student mid-setup is not chased by both
   *    the setup screen and a notification;
   *  - while the alert is on screen, a broken seal does NOT re-sound: the throttle
   *    is ALERT_THROTTLE_MS, which is also how often a *persisting* problem is
   *    re-raised so it cannot be ignored forever;
   *  - restoring the seal cancels it (see a11yRestored) and the JS "Later" button
   *    cancels it too (dismissSealAlert), which only re-arms on the next throttle.
   */
  private fun syncSealAlert(why: String) {
    val p = prefs
    val enforcing = AccessibilityHealth.isEnforcing(this)
    val sealed = p.getBoolean("active", false)
    val everEnabled = p.getLong("a11yBoundAt", 0L) > 0L
    val up = p.getInt("sealAlertUp", 0) == 1
    val now = System.currentTimeMillis()
    if (enforcing) {
      if (up) {
        try {
          getSystemService(NotificationManager::class.java)?.cancel(ALERT_ID)
        } catch (_: Throwable) { }
        p.edit().putInt("sealAlertUp", 0).remove("sealAlertWhy").apply()
      }
      return
    }
    if (!everEnabled && !sealed) return
    if (up && now - p.getLong("sealAlertAt", 0L) < ALERT_THROTTLE_MS) return
    // Tapping the alert opens the app (MainActivity is in the *app* module, so the
    // launch intent is looked up rather than referenced by class — a class name in
    // a library module would not compile and would break the build for the OEMs).
    val flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) android.app.PendingIntent.FLAG_IMMUTABLE else 0)
    val open = try {
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        android.app.PendingIntent.getActivity(
          this, 4404, it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags
        )
      }
    } catch (_: Throwable) {
      null
    }
    val n = Notification.Builder(this, ALERT_CHANNEL)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(if (sealed) "BT LOCKDOWN — seal is OFF during your session" else "BT LOCKDOWN — seal service is off")
      .setContentText(
        if (sealed) {
          "Blocked apps are not being intercepted any more. The phone stays locked and the " +
            "internet shield is holding — tap to switch the seal back on."
        } else {
          "Your session and timetable still sync, but blocked apps are not intercepted. " +
            "Tap to re-enable it (Settings \u2192 Accessibility \u2192 BT LOCKDOWN)."
        }
      )
      .setStyle(Notification.BigTextStyle().bigText(
        if (sealed) {
          "Blocked apps are not being intercepted any more. The device stays sealed and the " +
            "network shield is holding, so social apps will not load. Cause: " +
            describeA11yLoss(p)
        } else {
          "Android or the battery manager switched off the BT LOCKDOWN seal service. Re-enable " +
            "it in Settings \u2192 Accessibility \u2192 BT LOCKDOWN. Cause: " + describeA11yLoss(p)
        }
      ))
      .setAutoCancel(true)
      .setOnlyAlertOnce(up)
    if (open != null) n.setContentIntent(open)
    try {
      getSystemService(NotificationManager::class.java)?.notify(ALERT_ID, n.build())
      p.edit().putLong("sealAlertAt", now).putInt("sealAlertUp", 1).putString("sealAlertWhy", why).apply()
      // Tell JS so an open app shows the banner in the same second, without the
      // student having to pull-to-refresh.
      Bridge.emit("sealOff", mapOf("why" to why, "sealed" to sealed))
    } catch (_: Throwable) { }
  }

  /** Human-readable cause, straight from the seal layer's own record. */
  private fun describeA11yLoss(p: android.content.SharedPreferences): String {
    val why = p.getString("a11yLastDropWhy", "") ?: ""
    val at = p.getLong("a11yLastDropAt", 0L)
    val when0 = if (at > 0L) {
      val mins = ((System.currentTimeMillis() - at) / 60_000L).coerceAtLeast(0L)
      if (mins < 1L) "just now" else if (mins < 60L) "$mins min ago" else "${mins / 60} h ago"
    } else {
      "unknown time"
    }
    val label = when (why) {
      AccessibilityHealth.WHY_USER_TOGGLE -> "switched off on this device"
      AccessibilityHealth.WHY_PROCESS_KILLED -> "the phone killed BT LOCKDOWN in the background"
      AccessibilityHealth.WHY_NEVER_ENABLED -> "never enabled on this device"
      else -> "lost"
    }
    return "$label ($when0)"
  }

  /** Refresh the persistent notification (sealed vs. standing by, and while armed). */
  private fun updateOngoingNotification() {
    try {
      val nm = getSystemService(NotificationManager::class.java) ?: return
      nm.notify(NOTIF_ID, buildNotification())
    } catch (_: Throwable) { }
  }

  companion object {
    const val PREFS = "bt.lockdown"
    private const val CHANNEL = "bt_lockdown"
    private const val NOTIF_ID = 4401
    private const val ALERT_CHANNEL = "bt_lockdown_alert"
    private const val ALERT_ID = 4403
    /** Re-raise interval for a problem that is still there (30 min). */
    private const val ALERT_THROTTLE_MS = 30 * 60 * 1000L

    /**
     * Clear the seal alert from JS (the banner's "Later" / "Fix now"). This only
     * hides what the student has acknowledged; it does not re-arm anything, and the
     * watchdog will raise it again after the throttle if the seal is still down.
     */
    fun dismissSealAlert(ctx: Context) {
      try {
        ctx.getSystemService(NotificationManager::class.java)?.cancel(ALERT_ID)
      } catch (_: Throwable) { }
      try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
          .putInt("sealAlertUp", 0)
          .putLong("sealAlertAt", System.currentTimeMillis())
          .apply()
      } catch (_: Throwable) { }
    }
    private const val ACTION_STOP = "com.btsoftware.lockdown.STOP"
    const val ACTION_SHOW = "com.btsoftware.lockdown.SHOW"
    const val ACTION_HIDE = "com.btsoftware.lockdown.HIDE"
    const val ACTION_CORNER = "com.btsoftware.lockdown.CORNER"
    const val ACTION_CORNER_OFF = "com.btsoftware.lockdown.CORNER_OFF"
    const val ACTION_IDLE = "com.btsoftware.lockdown.IDLE"
    private const val ACTION_ENFORCE = "com.btsoftware.lockdown.ENFORCE"
    private const val ACTION_NOTIF = "com.btsoftware.lockdown.NOTIF"
    private const val GRACE_MS = 90_000L
    private const val IDLE_TICK_MS = 20_000L

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

    /** Keep-alive: start the watchdog in idle mode so auto-activation works. */
    fun startIdle(ctx: Context) {
      if (running) {
        send(ctx, ACTION_IDLE)
      } else {
        start(ctx)
        send(ctx, ACTION_IDLE)
      }
    }

    fun show(ctx: Context) {
      send(ctx, ACTION_SHOW)
    }

    fun hide(ctx: Context) {
      send(ctx, ACTION_HIDE)
    }

    /** Show the corner countdown chip counting to targetAt (epoch ms). */
    fun corner(ctx: Context, targetAt: Long) {
      val i = Intent(ctx, LockdownOverlayService::class.java).setAction(ACTION_CORNER)
        .putExtra("targetAt", targetAt)
      sendIntent(i, ctx)
    }

    fun cornerOff(ctx: Context) {
      send(ctx, ACTION_CORNER_OFF)
    }

    /**
     * Run one enforcement pass right now (seal + network shield) instead of on the
     * next tick. Used by the accessibility service when the seal is lost/restored
     * and by the VPN service, so the layers never wait up to 60 s for each other.
     */
    fun enforceNow(ctx: Context) {
      if (running) {
        send(ctx, ACTION_ENFORCE)
      } else {
        // No watchdog to delegate to: do the (cheap, I/O-free) pass here.
        try { NetworkProtectionManager.ensure(ctx) } catch (_: Throwable) { }
      }
    }

    /** Same as [enforceNow] but restarts the idle loop when nothing is running. */
    fun ensureProtectionNow(ctx: Context) {
      if (running) send(ctx, ACTION_ENFORCE) else startIdle(ctx)
    }

    /** Re-render the persistent notification (protection state changed). */
    fun refreshNotification(ctx: Context) {
      if (running) send(ctx, ACTION_NOTIF)
    }

    /**
     * Server-anchored wall clock, also for [NetworkProtectionManager]'s break
     * window: a rewound device clock must not lengthen a break any more than it
     * can lengthen a session.
     */
    fun serverNow(ctx: Context): Long =
      System.currentTimeMillis() +
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("clockOffsetMs", 0L)

    fun stop(ctx: Context) {
      val i = Intent(ctx, LockdownOverlayService::class.java).setAction(ACTION_STOP)
      try { ctx.startService(i) } catch (_: Throwable) {
        prefsClear(ctx)
      }
    }

    private fun send(ctx: Context, action: String) {
      val i = Intent(ctx, LockdownOverlayService::class.java).setAction(action)
      sendIntent(i, ctx)
    }

    private fun sendIntent(i: Intent, ctx: Context) {
      if (running) {
        try { ctx.startService(i) } catch (_: Throwable) { }
      } else {
        // Service is not running: start it (default action boots the watchdog),
        // then deliver the intent — Android queues both in order.
        start(ctx)
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
