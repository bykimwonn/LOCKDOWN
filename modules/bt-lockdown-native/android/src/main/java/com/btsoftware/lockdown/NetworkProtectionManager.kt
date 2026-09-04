package com.btsoftware.lockdown

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.SystemClock
import android.os.UserManager

/**
 * Third enforcement layer: the network shield.
 *
 * WHY THIS EXISTS
 * The accessibility service is what intercepts a blocked app *launch*. OEM
 * battery managers (MIUI/HyperOS in particular) and the student's own Settings
 * toggle can take it away mid-session, and when that happens the launch
 * interceptor is gone. The network shield is deliberately built so it does NOT
 * depend on accessibility at all:
 *
 *   LOCKDOWN START
 *         |
 *   BT LOCKDOWN CORE (LockdownOverlayService watchdog)
 *         |
 *         +--> AccessibilityHealth   launch interception + hard seal
 *         +--> Network shield        LockdownVpnService blackhole tunnel
 *         |                          (routing is enforced by the kernel/netd,
 *         |                           not by our process)
 *         +--> this HEALTH CONTROLLER: verify -> repair -> report
 *                      |
 *                      v
 *              PROTECTION STATE (prefs -> notification + app UI + /sync)
 *
 * HOW IT BLOCKS
 * [LockdownVpnService] establishes a local `VpnService` tunnel whose packets are
 * never read, with `addRoute("0.0.0.0", 0)` (plus `::/0` when the ROM accepts
 * it). Everything routed into that tunnel dies, so an app has no usable
 * Internet. BT LOCKDOWN's own package is excluded (`addDisallowedApplication`)
 * so session heartbeats, violation reporting and the school's remote kill
 * switch keep working while every other app is dark.
 *
 * RESTART PROTECTION — the two sanctioned mechanisms
 *  1. [ensure] runs on every watchdog tick, from the accessibility service's
 *     onServiceConnected and from BOOT_COMPLETED, so a tunnel that died with a
 *     killed process is rebuilt while a session is armed.
 *  2. On a school-provisioned **device owner** device we hand the policy to the
 *     OS: `setAlwaysOnVpnPackage(admin, ourPackage, lockdown = true,
 *     lockdownAllowlist = { ourPackage })`. Android then starts the tunnel
 *     itself at boot, keeps it up on its own, blocks all traffic for
 *     non-exempted apps *while the tunnel is not connected* — and from Android
 *     11 the user cannot turn off an admin-configured always-on VPN. That is the
 *     only way to survive a force-stop of our process; a self-restarting loop
 *     never is, and trying to outvote the OS UI is both against Play policy for
 *     accessibility/VPN use and technically futile (two VPNs just disconnect
 *     each other).
 *
 * We do NOT hide this and we do NOT fight the user's explicit disconnect:
 * [onRevokedByUser] honours it and reports it (recorded as tamper during a
 * sealed session, same treatment as accessibility_off). On personal,
 * unmanaged phones Android intentionally limits what an app may force onto the
 * device — there the shield is an extra layer, not a cage. Full lockdown is the
 * institution-mode (Device Owner / EMM) path, which is also where consent comes
 * from the school instead of the student.
 *
 * SAFETY — a phone must never be stranded offline by a bug
 *  - default OFF; arming a mode needs explicit consent (or device owner);
 *  - the block tracks `prefs.active` exactly: session over / server says
 *    inactive / token dead / break window -> released on the next tick;
 *  - hard ceiling [MAX_BLOCK_MS] releases even if every other signal is broken;
 *  - [LockdownVpnService] refuses to hold a tunnel when [shouldBlockNow] is
 *    false, so a stale "armed" flag after a reboot cannot keep a student offline;
 *  - device-owner always-on + lockdown + the VPN user restriction are cleared on
 *    every release. The three exits are: session ends, the teacher ends it in
 *    BT LEARNING (the phone sees that within one tick), or the school clears the
 *    policy through the DPC.
 */
object NetworkProtectionManager {

  /** Shield modes. `off` is the default; the other two need consent. */
  const val MODE_OFF = "off"
  /** Block the teacher's shield list only — other (school) apps keep working. */
  const val MODE_APPS = "apps"
  /** Default-deny: no Internet for anything except BT LOCKDOWN itself. */
  const val MODE_STRICT = "strict"

  /** Protection states, surfaced in the notification and the app UI. */
  const val STATE_OFF = "OFF"
  const val STATE_STARTING = "STARTING"
  const val STATE_ACTIVE = "ACTIVE"
  const val STATE_ON_BREAK = "ON_BREAK"
  const val STATE_DEGRADED = "DEGRADED"
  const val STATE_FAILED = "FAILED"
  const val STATE_REVOKED = "REVOKED_BY_USER"
  const val STATE_NO_CONSENT = "NEEDS_CONSENT"
  const val STATE_UNSUPPORTED = "NEEDS_VPN_PERMISSION"

  /** Absolute ceiling on a network block, whatever else is broken (8 h). */
  const val MAX_BLOCK_MS = 8 * 60 * 60 * 1000L

  private const val RETRY_STEP_MS = 20_000L
  private const val RETRY_MAX_MS = 5 * 60 * 1000L
  private const val CONTROL_CHANNEL_FRESH_MS = 150_000L
  private const val STARTING_STALL_MS = 15_000L
  private const val MAX_BREAK_MINUTES = 15
  private const val MAX_BREAKS_PER_SESSION = 2

  // prefs (not memory): the watchdog may be the only thing still running, and
  // the notification + JS both read this state.
  private const val K_MODE = "netShieldMode"
  private const val K_CONSENT = "netShieldConsent"
  private const val K_LOCK_VPN_UI = "netShieldLockVpnSettings"
  private const val K_STATE = "netProtectState"
  private const val K_DETAIL = "netProtectDetail"
  private const val K_SINCE = "netProtectSince"
  private const val K_BLOCKED_SINCE = "netBlockedSince"
  private const val K_NEXT_RETRY = "netNextRetryAt"
  private const val K_FAIL_STREAK = "netFailStreak"
  private const val K_REVOKES = "netRevokeCount"
  private const val K_TUNNELS = "netTunnelCount"
  private const val K_BREAK_UNTIL = "netBreakUntil"
  private const val K_BREAK_COUNT = "netBreakCount"
  private const val K_CTRL_OK = "netControlOkAt"
  private const val K_START_AT = "netStartAttemptAt"
  private const val K_TUNNEL_SIG = "netTunnelCapture"

  private fun prefs(ctx: Context) =
    ctx.getSharedPreferences(LockdownOverlayService.PREFS, Context.MODE_PRIVATE)

  // ------------------------------------------------------------------
  // configuration
  // ------------------------------------------------------------------

  fun mode(ctx: Context): String {
    // No reliance on smart casts from a `when` subject: getString returns String?
    // and the EAS compile is where a nullable leak would show up.
    val m = prefs(ctx).getString(K_MODE, MODE_OFF) ?: MODE_OFF
    return if (m == MODE_APPS || m == MODE_STRICT) m else MODE_OFF
  }

  fun consentGiven(ctx: Context): Boolean = prefs(ctx).getBoolean(K_CONSENT, false)

  /**
   * Opt-in user restriction that hides Settings -> VPN, so a student cannot
   * disconnect the shield from there. Device-owner only, default off: a school
   * that manages the fleet turns this on deliberately; a personal phone never
   * gets its Settings taken away silently.
   */
  fun lockVpnSettingsRequested(ctx: Context): Boolean =
    prefs(ctx).getBoolean(K_LOCK_VPN_UI, false) && LockTaskController.isDeviceOwner(ctx)

  /** The shield is allowed to run: consented locally, or owned by the school. */
  fun authorized(ctx: Context): Boolean =
    consentGiven(ctx) || LockTaskController.isDeviceOwner(ctx)

  /** Persist a mode change. @return the state the shield ends up in. */
  fun setMode(ctx: Context, mode: String, consent: Boolean, lockVpnUi: Boolean): String {
    val normalized = when (mode) {
      MODE_APPS, MODE_STRICT -> mode
      else -> MODE_OFF
    }
    val p = prefs(ctx)
    if (normalized == MODE_OFF) {
      p.edit().putString(K_MODE, MODE_OFF).apply()
      release(ctx, "mode-off")
      return STATE_OFF
    }
    if (!consent && !LockTaskController.isDeviceOwner(ctx)) {
      p.edit().putString(K_MODE, MODE_OFF).apply()
      setState(ctx, STATE_NO_CONSENT, "Network shield needs consent before it can be armed.")
      return STATE_NO_CONSENT
    }
    p.edit()
      .putString(K_MODE, normalized)
      .putBoolean(K_CONSENT, true)
      .putBoolean(K_LOCK_VPN_UI, lockVpnUi)
      .putInt(K_FAIL_STREAK, 0)
      .remove(K_NEXT_RETRY)
      .apply()
    // One pass right away (and start the watchdog if it is not up), so the caller
    // reads the real state instead of a stale one.
    if (shouldBlockNow(ctx)) ensure(ctx)
    if (LockdownOverlayService.running) LockdownOverlayService.ensureProtectionNow(ctx)
    else LockdownOverlayService.startIdle(ctx)
    return state(ctx)
  }

  /** Has the VPN consent dialog already been answered for this app? */
  fun isVpnPrepared(ctx: Context): Boolean = try {
    VpnService.prepare(ctx) == null
  } catch (_: Throwable) {
    false
  }

  /** The system consent Intent to launch, or null when already prepared. */
  fun vpnPrepareIntent(ctx: Context): android.content.Intent? = try {
    VpnService.prepare(ctx)
  } catch (_: Throwable) {
    null
  }

  /**
   * Can a tunnel be established at all right now? On a device-owner device the
   * always-on policy carries the grant, so no dialog is needed; otherwise the
   * student has to accept the system "BT LOCKDOWN will start a VPN" dialog once.
   */
  fun canEstablish(ctx: Context): Boolean = isVpnPrepared(ctx) || LockTaskController.isDeviceOwner(ctx)

  // ------------------------------------------------------------------
  // policy: should traffic be blocked at this exact moment?
  // ------------------------------------------------------------------

  private fun sessionActive(ctx: Context): Boolean = prefs(ctx).getBoolean("active", false)

  fun onBreak(ctx: Context): Boolean {
    val until = prefs(ctx).getLong(K_BREAK_UNTIL, 0L)
    return until > 0L && LockdownOverlayService.serverNow(ctx) < until
  }

  /** Seconds left of the current scheduled break (0 when not on one). */
  fun breakSecondsLeft(ctx: Context): Int {
    val until = prefs(ctx).getLong(K_BREAK_UNTIL, 0L)
    if (until <= 0L) return 0
    return ((until - LockdownOverlayService.serverNow(ctx)) / 1000L).toInt().coerceAtLeast(0)
  }

  /** True when the block has run out its ceiling and must self-release. */
  fun pastCeiling(ctx: Context): Boolean {
    val since = prefs(ctx).getLong(K_BLOCKED_SINCE, 0L)
    return since > 0L && SystemClock.elapsedRealtime() - since > MAX_BLOCK_MS
  }

  /** The single answer both services use. */
  fun shouldBlockNow(ctx: Context): Boolean {
    if (mode(ctx) == MODE_OFF) return false
    if (!authorized(ctx)) return false
    if (!sessionActive(ctx)) return false
    if (onBreak(ctx)) return false
    if (pastCeiling(ctx)) return false
    return true
  }

  /**
   * What the tunnel must capture.
   *  MODE_STRICT -> empty list: every app except BT LOCKDOWN (default-deny).
   *  MODE_APPS   -> only the packages on the teacher's shield list, so the
   *                 school's own apps and allowed study apps keep working.
   */
  /**
   * Identity of "what the tunnel captures right now". `strict` has a fixed
   * signature; per-app mode hashes the sorted package list, so any edit to the
   * shield list is visible without re-reading the tunnel.
   */
  private fun captureSignature(ctx: Context): String =
    if (mode(ctx) == MODE_STRICT) "strict"
    else "apps:" + tunnelAllowlist(ctx).sorted().joinToString(",")

  fun tunnelAllowlist(ctx: Context): List<String> {
    if (mode(ctx) != MODE_APPS) return emptyList()
    val raw = prefs(ctx).getString("blocked", "") ?: ""
    return raw.split(",")
      .map { it.trim() }
      .filter { it.isNotEmpty() && it != ctx.packageName }
      .distinct()
  }

  // ------------------------------------------------------------------
  // the controller
  // ------------------------------------------------------------------

  /**
   * Verify / repair / report. Cheap enough for the 5 s watchdog tick: when the
   * tunnel is up it is two ConnectivityManager reads, no I/O.
   */
  fun ensure(ctx: Context) {
    if (!shouldBlockNow(ctx)) {
      if (LockdownVpnService.connected || state(ctx) != STATE_OFF) release(ctx, reasonForRelease(ctx))
      return
    }
    if (!canEstablish(ctx)) {
      setState(ctx, STATE_UNSUPPORTED, "The system VPN permission has not been granted yet.")
      return
    }
    // Per-app mode with no shield list yet must not fall through to a global block
    // and must not keep yesterday's list alive: hold no tunnel, say why, stay armed.
    if (mode(ctx) == MODE_APPS && tunnelAllowlist(ctx).isEmpty()) {
      if (LockdownVpnService.connected) LockdownVpnService.stop(ctx)
      LockdownVpnService.forceClose()
      setState(ctx, STATE_DEGRADED, "No shield list from the school yet — nothing to block.")
      return
    }
    if (LockdownVpnService.connected) {
      // The shield list can change mid-session (the teacher edits it in
      // BT LEARNING). The tunnel was built from the old one, and a VpnService
      // cannot be re-configured in place, so rebuild it — otherwise "apps" mode
      // silently keeps blocking the set of apps from session start.
      if (captureSignature(ctx) != prefs(ctx).getString(K_TUNNEL_SIG, null)) {
        setState(ctx, STATE_STARTING, "Shield list changed — rebuilding the block tunnel.")
        LockdownVpnService.restart(ctx)
      } else {
        verify(ctx)
      }
      return
    }
    // Honour the retry backoff: a ROM that refuses our tunnel must not be
    // hammered every tick.
    val next = prefs(ctx).getLong(K_NEXT_RETRY, 0L)
    val now = SystemClock.elapsedRealtime()
    // We asked for the tunnel and the service never reported one: Android refused
    // the (background) start. Say FAILED rather than leaving "blocking internet…"
    // on screen, which would overstate the protection.
    val startedAt = prefs(ctx).getLong(K_START_AT, 0L)
    if (state(ctx) == STATE_STARTING && startedAt > 0L && now - startedAt > STARTING_STALL_MS) {
      setState(ctx, STATE_FAILED, "The VPN service never reported a tunnel — the start was refused while the app was in the background.")
      prefs(ctx).edit().putLong(K_NEXT_RETRY, now + backoffFor(1)).remove(K_START_AT).apply()
      return
    }
    if (next > now) return
    // If another app owns a VPN right now, do not start a VPN war: Android keeps
    // exactly one tunnel and the two apps would just disconnect each other.
    if (probe(ctx).vpnNetwork) {
      setState(ctx, STATE_DEGRADED, "Another app owns the VPN tunnel; not fighting it.")
      return
    }
    if (prefs(ctx).getLong(K_BLOCKED_SINCE, 0L) == 0L) {
      prefs(ctx).edit().putLong(K_BLOCKED_SINCE, now).apply()
    }
    setState(ctx, STATE_STARTING, "Establishing the block tunnel.")
    prefs(ctx).edit().putLong(K_START_AT, now).apply()
    if (!LockdownVpnService.start(ctx)) {
      onTunnelFailed(ctx, "The system refused to start the VPN service while the app was in the background.")
    }
  }

  /**
   * "VPN started" is not "traffic is actually blocked". Verify that the
   * framework really has a VPN network, that our own control channel is excluded
   * from it (the proof the school can still reach the device), and that a
   * heartbeat was accepted recently. Anything weaker is DEGRADED, never ACTIVE.
   */
  private fun verify(ctx: Context) {
    val h = probe(ctx)
    val ctrlFresh =
      SystemClock.elapsedRealtime() - prefs(ctx).getLong(K_CTRL_OK, 0L) < CONTROL_CHANNEL_FRESH_MS
    val detail = buildString {
      append("tunnel up")
      append(if (h.vpnNetwork) "; netd routing" else "; no VPN network in ConnectivityManager")
      append(if (h.selfExcluded) "; sync path excluded" else "; sync path is inside the tunnel")
      append(if (ctrlFresh) "; server reachable" else "; no accepted heartbeat in 150 s")
    }
    if (h.vpnNetwork && h.selfExcluded) {
      val before = state(ctx)
      prefs(ctx).edit().putInt(K_FAIL_STREAK, 0).remove(K_NEXT_RETRY).apply()
      setState(ctx, STATE_ACTIVE, detail)
      if (before != STATE_ACTIVE) Bridge.emit("netProtectActive")
      // Hand the tunnel to Android once per transition (and if the OS-side policy
      // went away) — not on every 5 s tick.
      if (before != STATE_ACTIVE || !alwaysOnVpnOurs(ctx)) applyDeviceOwnerPolicy(ctx)
    } else {
      val fails = prefs(ctx).getInt(K_FAIL_STREAK, 0) + 1
      prefs(ctx).edit()
        .putInt(K_FAIL_STREAK, fails)
        .putLong(K_NEXT_RETRY, SystemClock.elapsedRealtime() + backoffFor(fails))
        .apply()
      // The tunnel is up but the routing state disagrees (or our exclusion did
      // not take): rebuild it once, then back off.
      if (fails >= 2) LockdownVpnService.restart(ctx)
      setState(ctx, STATE_DEGRADED, detail)
      if (fails == 3) Bridge.emit("netProtectDegraded")
    }
  }

  /** Release the shield and clear every OS-level policy we hold. */
  fun release(ctx: Context, reason: String) {
    // K_BLOCKED_SINCE is deliberately NOT cleared here: the safety ceiling counts
    // from the first block attempt of the session, so a flapping tunnel can never
    // extend a block past MAX_BLOCK_MS. onSessionArmed() resets it per session.
    prefs(ctx).edit()
      .putLong(K_NEXT_RETRY, 0L)
      .putInt(K_FAIL_STREAK, 0)
      .putLong(K_BREAK_UNTIL, 0L)
      .remove(K_TUNNEL_SIG)
      .apply()
    clearDeviceOwnerPolicy(ctx)
    LockdownVpnService.stop(ctx)
    // Belt and braces: if the stop command could not be delivered (background
    // start restrictions), the descriptor is closed directly, so the student can
    // never be left offline by our own release path.
    LockdownVpnService.forceClose()
    setState(ctx, STATE_OFF, "Network shield idle ($reason).")
  }

  /**
   * Scheduled break: release the *network* layer for a bounded window while the
   * seal itself stays up. Capped locally (minutes + breaks per session) because
   * a student must not be able to farm an unlimited pause; the school's own
   * timetable remains the real source of breaks.
   */
  fun grantBreak(ctx: Context, minutes: Int): Boolean {
    if (!sessionActive(ctx)) return false
    if (mode(ctx) == MODE_OFF) return false
    val p = prefs(ctx)
    if (p.getInt(K_BREAK_COUNT, 0) >= MAX_BREAKS_PER_SESSION) return false
    val mins = minutes.coerceIn(1, MAX_BREAK_MINUTES)
    val until = LockdownOverlayService.serverNow(ctx) + mins * 60_000L
    p.edit()
      .putLong(K_BREAK_UNTIL, until)
      .putInt(K_BREAK_COUNT, p.getInt(K_BREAK_COUNT, 0) + 1)
      .apply()
    clearDeviceOwnerPolicy(ctx)
    LockdownVpnService.stop(ctx)
    LockdownVpnService.forceClose()
    setState(ctx, STATE_ON_BREAK, "Break for $mins min — network allowed.")
    return true
  }

  /** Called by the watchdog on every accepted server round-trip. */
  fun noteControlChannel(ctx: Context) {
    try {
      prefs(ctx).edit().putLong(K_CTRL_OK, SystemClock.elapsedRealtime()).apply()
    } catch (_: Throwable) { }
  }

  /** Reset the per-session break counter (called when a new session is armed). */
  fun onSessionArmed(ctx: Context) {
    prefs(ctx).edit()
      .putInt(K_BREAK_COUNT, 0)
      .putLong(K_BREAK_UNTIL, 0L)
      .putLong(K_BLOCKED_SINCE, 0L)
      .putInt(K_FAIL_STREAK, 0)
      .remove(K_NEXT_RETRY)
      .apply()
  }

  // ------------------------------------------------------------------
  // callbacks from LockdownVpnService
  // ------------------------------------------------------------------

  fun onTunnelUp(ctx: Context, note: String?) {
    val p = prefs(ctx)
    val edit = p.edit()
      .putInt(K_TUNNELS, p.getInt(K_TUNNELS, 0) + 1)
      // What this tunnel actually captures, so the next tick can tell whether the
      // school's list moved under it.
      .putString(K_TUNNEL_SIG, captureSignature(ctx))
    if (p.getLong(K_BLOCKED_SINCE, 0L) == 0L) edit.putLong(K_BLOCKED_SINCE, SystemClock.elapsedRealtime())
    edit.remove(K_START_AT).apply()
    verify(ctx)
    if (note != null) appendDetail(ctx, note)
    applyDeviceOwnerPolicy(ctx)
    LockdownOverlayService.refreshNotification(ctx)
  }

  fun onTunnelFailed(ctx: Context, why: String) {
    val fails = prefs(ctx).getInt(K_FAIL_STREAK, 0) + 1
    prefs(ctx).edit()
      .putInt(K_FAIL_STREAK, fails)
      .putLong(K_NEXT_RETRY, SystemClock.elapsedRealtime() + backoffFor(fails))
      .apply()
    // A technical failure (ROM refused the tunnel, another VPN owns it) is not
    // student tamper: surface it, never penalise it.
    setState(ctx, STATE_FAILED, why)
    if (fails == 3) Bridge.emit("netProtectDown")
    LockdownOverlayService.refreshNotification(ctx)
  }

  /**
   * Explicit disconnect — the system VPN panel, another VPN taking over, or the
   * admin clearing always-on. Honoured, not fought. During a sealed session on a
   * school device that is a tamper event, recorded exactly like accessibility_off
   * so the teacher sees it; and on a device-owner device the OS policy re-asserts
   * the tunnel by itself, so the escape is short by design rather than by us
   * overriding the user's choice in the OS UI.
   */
  fun onRevokedByUser(ctx: Context, reason: String?) {
    val p = prefs(ctx)
    p.edit()
      .putInt(K_REVOKES, p.getInt(K_REVOKES, 0) + 1)
      .putLong(K_BLOCKED_SINCE, 0L)
      .putLong(K_NEXT_RETRY, SystemClock.elapsedRealtime() + RETRY_STEP_MS)
      .apply()
    setState(ctx, STATE_REVOKED, reason ?: "The VPN tunnel was disconnected.")
    Bridge.emit("netRevoked", mapOf("reason" to (reason ?: "")))
    if (sessionActive(ctx)) {
      NativeReporter.report(
        ctx, "netShieldOff", "tamper_detected",
        "The network shield (VPN) was disconnected during a sealed session."
      )
    }
    LockdownOverlayService.refreshNotification(ctx)
  }

  fun onTunnelDown(ctx: Context, reason: String) {
    val was = state(ctx)
    if (was == STATE_ACTIVE || was == STATE_STARTING || was == STATE_DEGRADED) {
      setState(ctx, STATE_OFF, "Network shield released ($reason).")
    }
    LockdownOverlayService.refreshNotification(ctx)
  }

  // ------------------------------------------------------------------
  // state helpers
  // ------------------------------------------------------------------

  fun state(ctx: Context): String =
    prefs(ctx).getString(K_STATE, STATE_OFF) ?: STATE_OFF

  private fun setState(ctx: Context, next: String, detail: String) {
    val p = prefs(ctx)
    val previous = p.getString(K_STATE, STATE_OFF) ?: STATE_OFF
    val edit = p.edit().putString(K_DETAIL, detail)
    if (previous != next) {
      edit.putString(K_STATE, next)
      edit.putLong(K_SINCE, SystemClock.elapsedRealtime())
    }
    edit.apply()
  }

  /** Fold a one-off diagnostic (e.g. "IPv6 route rejected") into the detail. */
  private fun appendDetail(ctx: Context, note: String) {
    val p = prefs(ctx)
    val current = p.getString(K_DETAIL, "") ?: ""
    if (current.contains(note)) return
    p.edit().putString(K_DETAIL, (if (current.isEmpty()) note else "$current · $note")).apply()
  }

  private fun detailOrDefault(ctx: Context, fallback: String): String {
    val d = prefs(ctx).getString(K_DETAIL, "")?.trim() ?: ""
    return if (d.isEmpty()) fallback else d
  }

  private fun backoffFor(fails: Int): Long =
    (RETRY_STEP_MS shl fails.coerceIn(0, 4)).coerceAtMost(RETRY_MAX_MS)

  private fun reasonForRelease(ctx: Context): String = when {
    pastCeiling(ctx) -> "ceiling"
    onBreak(ctx) -> "break"
    mode(ctx) == MODE_OFF -> "mode-off"
    !authorized(ctx) -> "no-consent"
    else -> "no-session"
  }

  /** Everything the UI needs, in one snapshot. */
  fun snapshot(ctx: Context): Map<String, Any?> {
    val p = prefs(ctx)
    val st = state(ctx)
    val h = probe(ctx)
    val blockedSince = p.getLong(K_BLOCKED_SINCE, 0L)
    val blockedForMs =
      if (blockedSince > 0L && st == STATE_ACTIVE) SystemClock.elapsedRealtime() - blockedSince else 0L
    return mapOf(
      "mode" to mode(ctx),
      "consent" to consentGiven(ctx),
      "deviceOwner" to LockTaskController.isDeviceOwner(ctx),
      "state" to st,
      "detail" to (p.getString(K_DETAIL, "") ?: ""),
      "statusLine" to statusLine(ctx),
      "protection" to protectionLevel(ctx),
      "sealed" to sessionActive(ctx),
      "onBreak" to onBreak(ctx),
      "breakSecondsLeft" to breakSecondsLeft(ctx),
      "breakCount" to p.getInt(K_BREAK_COUNT, 0),
      "breakMinutesCap" to MAX_BREAK_MINUTES,
      "breaksCap" to MAX_BREAKS_PER_SESSION,
      "blockedForSeconds" to (blockedForMs / 1000L).toInt(),
      "ceilingSeconds" to (MAX_BLOCK_MS / 1000L).toInt(),
      "revokeCount" to p.getInt(K_REVOKES, 0),
      "tunnelCount" to p.getInt(K_TUNNELS, 0),
      "failStreak" to p.getInt(K_FAIL_STREAK, 0),
      "vpnPrepared" to isVpnPrepared(ctx),
      "tunnelUp" to LockdownVpnService.connected,
      "vpnNetworkSeen" to h.vpnNetwork,
      "selfExcluded" to h.selfExcluded,
      "controlChannelOk" to
        (SystemClock.elapsedRealtime() - p.getLong(K_CTRL_OK, 0L) < CONTROL_CHANNEL_FRESH_MS),
      "lockVpnUi" to lockVpnSettingsRequested(ctx),
      "alwaysOnVpn" to alwaysOnVpnOurs(ctx),
      "capturedApps" to tunnelAllowlist(ctx).size
    )
  }

  /** One-line human summary for the persistent notification / settings card. */
  fun statusLine(ctx: Context): String = when (state(ctx)) {
    STATE_ACTIVE ->
      if (mode(ctx) == MODE_STRICT) "internet blocked (all apps)" else "internet blocked (shield apps)"
    STATE_STARTING -> "blocking internet…"
    STATE_ON_BREAK -> {
      val mins = (breakSecondsLeft(ctx) + 59) / 60
      "on break — internet allowed for ~$mins min"
    }
    // These states have several possible causes, and the cause is what the reader
    // needs, so quote the controller's own detail instead of a generic phrase.
    STATE_DEGRADED -> "DEGRADED — ${detailOrDefault(ctx, "tunnel up but not enforcing")}"
    STATE_FAILED -> "FAILED — ${detailOrDefault(ctx, "this device refused the tunnel")}"
    STATE_REVOKED -> "DISCONNECTED on the device"
    STATE_NO_CONSENT -> "waiting for consent"
    STATE_UNSUPPORTED -> "waiting for the VPN permission"
    else -> "off"
  }

  /**
   * "Full Protection" only when both independent layers actually work. This is
   * the string the student, parent and teacher see, so it must never overstate:
   *  FULL        accessibility bound AND network shield verified enforcing
   *  SEAL_ONLY   launches intercepted, Internet still available
   *  NETWORK_ONLY seal is off (accessibility lost) but social apps have no net
   *  DEGRADED    neither layer is verified — the notification says so loudly
   */
  fun protectionLevel(ctx: Context): String {
    val a11y = AccessibilityHealth.isEnforcing(ctx)
    val net = state(ctx) == STATE_ACTIVE
    return when {
      a11y && net -> "FULL"
      a11y -> "SEAL_ONLY"
      net -> "NETWORK_ONLY"
      else -> "DEGRADED"
    }
  }

  // ------------------------------------------------------------------
  // device-owner policy (institution mode only)
  // ------------------------------------------------------------------

  private fun dpm(ctx: Context): DevicePolicyManager? = LockTaskController.dpm(ctx)

  private fun alwaysOnVpnOurs(ctx: Context): Boolean {
    if (!LockTaskController.isDeviceOwner(ctx)) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    return try {
      ctx.packageName == dpm(ctx)?.getAlwaysOnVpnPackage(LockTaskController.adminComponent(ctx))
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * Hand the always-on tunnel to the OS while a session is sealed. Requires
   * device owner (EMM-provisioned or `adb shell dpm set-device-owner`); an
   * unprivileged no-op everywhere else.
   *
   * `lockdown = true` means "no networking for non-exempted apps while the VPN
   * is NOT connected", which is what closes the force-stop hole. The exemption
   * list carries our own package so BT LOCKDOWN can still reach BT LEARNING to
   * receive "session over" and to report violations. On API 24-28 the 4-arg
   * overload (with the exemption list) does not exist, so there we set always-on
   * WITHOUT lockdown rather than lock ourselves out of our own server.
   */
  private fun applyDeviceOwnerPolicy(ctx: Context) {
    if (!LockTaskController.isDeviceOwner(ctx)) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    if (!shouldBlockNow(ctx)) return
    val admin = LockTaskController.adminComponent(ctx)
    val manager = dpm(ctx) ?: return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        manager.setAlwaysOnVpnPackage(admin, ctx.packageName, true, setOf(ctx.packageName))
      } else {
        manager.setAlwaysOnVpnPackage(admin, ctx.packageName, false)
      }
    } catch (_: Throwable) {
      // NameNotFoundException / SecurityException / UnsupportedOperationException
      // (the ROM says the app does not support always-on). The tunnel still
      // works; only the OS-owned part is unavailable.
    }
    if (lockVpnSettingsRequested(ctx)) {
      try {
        manager.addUserRestriction(admin, UserManager.DISALLOW_CONFIG_VPN)
      } catch (_: Throwable) { }
    }
  }

  private fun clearDeviceOwnerPolicy(ctx: Context) {
    if (!LockTaskController.isDeviceOwner(ctx)) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val admin = LockTaskController.adminComponent(ctx)
    val manager = dpm(ctx) ?: return
    try {
      // From API 31 passing null only clears a configuration this admin created,
      // which is exactly what we want: never touch a VPN the user set up.
      if (manager.getAlwaysOnVpnPackage(admin) == ctx.packageName) {
        manager.setAlwaysOnVpnPackage(admin, null, false)
      }
    } catch (_: Throwable) { }
    if (lockVpnSettingsRequested(ctx)) {
      try {
        manager.clearUserRestriction(admin, UserManager.DISALLOW_CONFIG_VPN)
      } catch (_: Throwable) { }
    }
  }

  // ------------------------------------------------------------------
  // framework probe
  // ------------------------------------------------------------------

  private data class Health(val vpnNetwork: Boolean, val selfExcluded: Boolean)

  /**
   * What can honestly be verified from a normal app: an app cannot read netd's
   * per-UID rules, so we check the two observable consequences of the tunnel —
   * the framework has a VPN network, and our own traffic is excluded from it
   * (which is simultaneously the proof that enforcement does not blind us).
   */
  private fun probe(ctx: Context): Health {
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      ?: return Health(false, false)
    var vpn = false
    var selfExcluded = false
    try {
      val networks = cm.allNetworks ?: emptyArray()
      for (n in networks) {
        val cap = try {
          cm.getNetworkCapabilities(n)
        } catch (_: Throwable) {
          null
        } ?: continue
        if (cap.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) vpn = true
      }
      val active = try {
        cm.activeNetwork
      } catch (_: Throwable) {
        null
      }
      val ac = try {
        if (active != null) cm.getNetworkCapabilities(active) else null
      } catch (_: Throwable) {
        null
      }
      if (ac != null && ac.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) {
        selfExcluded = true
      }
    } catch (_: Throwable) { }
    return Health(vpn, selfExcluded)
  }
}
