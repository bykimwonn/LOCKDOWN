package com.btsoftware.lockdown

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor

/**
 * Local blackhole VPN — the part of the network shield that the kernel enforces.
 *
 * The tunnel is intentionally a sink: `establish()` hands us a file descriptor
 * and we never read from it, so every packet routed into it dies and the app
 * that sent it has no usable Internet. DNS dies with it too (this VPN network is
 * given no resolvers), which is what stops a blocked app from even finding a
 * server to retry against.
 *
 * Routing modes, decided by [NetworkProtectionManager]:
 *  - strict: `0.0.0.0/0` + `::/0` capture everything, and BT LOCKDOWN itself is
 *    excluded with `addDisallowedApplication`, so the session heartbeat, the
 *    violation-queue flush and the school's remote "end session" answer keep
 *    working while every other app is dark;
 *  - apps: the same default route, but only the packages the teacher shielded
 *    are captured (`addAllowedApplication`), so school apps still work.
 *
 * Lifecycle facts this design leans on — all documented Android behaviour:
 *  - the system shows its own persistent VPN key + dialog naming our session,
 *    so the block is visible and never hidden;
 *  - closing the descriptor restores networking immediately, including when the
 *    process crashes or is killed. That is why [NetworkProtectionManager.shouldBlockNow]
 *    is re-checked on every start and why a stale "armed" flag cannot strand a
 *    phone;
 *  - on a Device Owner device the manager additionally sets
 *    `setAlwaysOnVpnPackage(..., lockdown = true, ...)`, so the OS itself keeps
 *    the tunnel up across reboot and blocks traffic even while this process is
 *    dead. From Android 11 the user cannot switch off an admin-configured
 *    always-on VPN — that is the sanctioned "restart protection", not an
 *    app-level fight with the Settings UI;
 *  - `onRevoke` (user disconnect / another VPN taking over) is honoured and
 *    reported. We do not re-establish in a loop: two VPNs just disconnect each
 *    other, and outvoting the OS's own dialog is what the platform policies
 *    exist to stop.
 *
 * No notification and no wake lock of its own: the BT LOCKDOWN watchdog
 * foreground service keeps process importance up, the system's VPN binding is
 * what keeps this service alive while the tunnel is open.
 */
class LockdownVpnService : VpnService() {

  private var tunnel: ParcelFileDescriptor? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    connected = false
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP || !NetworkProtectionManager.shouldBlockNow(this)) {
      val reason = if (intent?.action == ACTION_STOP) "released" else "policy-says-idle"
      closeTunnel()
      NetworkProtectionManager.onTunnelDown(this, reason)
      stopSelf()
      return START_NOT_STICKY
    }
    // A VPN service started from the background sits on a short temporary
    // allowlist on Android 8+; make sure the watchdog foreground service exists
    // so the enforcing process is not an eviction candidate. Best effort — a
    // rejected background start here is not fatal, the tunnel is bound by the
    // system already at that point.
    if (!LockdownOverlayService.running) {
      try {
        LockdownOverlayService.startIdle(this)
      } catch (_: Throwable) { }
    }
    if (tunnel == null) openTunnel()
    return START_STICKY
  }

  override fun onDestroy() {
    closeTunnel()
    if (instance === this) instance = null
    super.onDestroy()
  }

  /** The system asked us down: user disconnect, another VPN, or the DPC cleared it. */
  override fun onRevoke() {
    closeTunnel()
    NetworkProtectionManager.onRevokedByUser(this, "The system disconnected the BT LOCKDOWN VPN tunnel.")
    super.onRevoke()
  }

  // ------------------------------------------------------------------
  // tunnel
  // ------------------------------------------------------------------

  private fun openTunnel() {
    val strict = NetworkProtectionManager.mode(this) == NetworkProtectionManager.MODE_STRICT
    val capture = if (strict) emptyList() else NetworkProtectionManager.tunnelAllowlist(this)
    if (!strict && capture.isEmpty()) {
      // Per-app mode with no shield list yet: nothing to block, so hold no tunnel
      // rather than silently turning into a global block. Not an error — the
      // controller reports "waiting for the school's list" (NetworkProtectionManager
      // .ensure) and the next tick re-reads it. Defensive copy of that guard here,
      // because this service is what would strand the student if it got it wrong.
      closeTunnel()
      NetworkProtectionManager.onTunnelDown(this, "nothing to capture")
      stopSelf()
      return
    }
    var result = runCatchingBuild(strict, capture, ipv6 = true)
    var note: String? = null
    if (result.fd == null && result.error == null) {
      // Some OEM kernels reject a builder carrying an IPv6 route (the ::/0 +
      // IPv6-address-family combination, issuetracker 149636790 class). Retry
      // IPv4-only rather than leaving the session unshielded — an IPv4 blackhole
      // still kills every app that resolves an A record — and say so in the status
      // instead of pretending a coverage we do not have.
      result = runCatchingBuild(strict, capture, ipv6 = false)
      if (result.fd != null) note = "This ROM rejected the IPv6 route — IPv4 blackhole only."
    }
    val fd = result.fd
    if (fd == null) {
      closeTunnel()
      NetworkProtectionManager.onTunnelFailed(
        this,
        result.error ?: "establish() returned null: VPN permission not granted yet, another " +
          "VPN owns the tunnel, or this ROM refuses a tunnel with no upstream."
      )
      stopSelf()
      return
    }
    tunnel = fd
    connected = true
    NetworkProtectionManager.onTunnelUp(this, note)
  }

  private class TunnelResult(val fd: ParcelFileDescriptor?, val error: String?)

  private fun runCatchingBuild(strict: Boolean, capture: List<String>, ipv6: Boolean): TunnelResult =
    try {
      establish(strict, capture, ipv6)
    } catch (_: Throwable) {
      // SecurityException / IllegalArgumentException from a hostile ROM: a
      // failure to report, never a crash of the watchdog process.
      TunnelResult(null, "The system refused to build the tunnel (exception).")
    }

  private fun establish(strict: Boolean, capture: List<String>, ipv6: Boolean): TunnelResult {
    val b = Builder()
      .setSession(SESSION_LABEL)
      .setMtu(MTU)
      .addAddress(TUNNEL_V4, V4_PREFIX)
      .addRoute("0.0.0.0", 0)
      // A dummy resolver inside the tunnel: some ROMs reject a VPN config with
      // no DNS server at all. Pointing it at our own blackhole address means the
      // query is routed into the sink and dies, so DNS fails exactly as intended
      // and no real resolver is ever contacted.
      .addDnsServer(TUNNEL_V4)
    if (ipv6) {
      b.addAddress(TUNNEL_V6, V6_PREFIX).addRoute("::", 0).addDnsServer(TUNNEL_V6)
    }
    if (strict) {
      // Strict mode: capture every app except ours. A Builder may carry an
      // allowed list OR a disallowed list, never both.
      try {
        b.addDisallowedApplication(packageName)
      } catch (_: PackageManager.NameNotFoundException) { }
    } else {
      // Per-app mode: capture only the shielded packages. A package that is not
      // installed skips rather than failing the whole tunnel.
      var added = 0
      for (pkg in capture) {
        try {
          b.addAllowedApplication(pkg)
          added++
        } catch (_: PackageManager.NameNotFoundException) { }
      }
      if (added == 0) {
        return TunnelResult(null, "None of the shielded apps are installed on this device.")
      }
    }
    // allowBypass() is deliberately not called: the system then offers no
    // in-dialog "Disconnect" while a session is sealed. The exits stay the ones
    // a school can audit — the session ending, the teacher ending it in
    // BT LEARNING, the Device Owner policy being cleared, or our process dying
    // (which closes the descriptor and restores the network).
    val fd = b.establish()
    return if (fd == null) TunnelResult(null, null) else TunnelResult(fd, null)
  }

  private fun closeTunnel() {
    tunnel?.let {
      try {
        it.close()
      } catch (_: Throwable) { }
    }
    tunnel = null
    connected = false
  }

  private data class TunnelConfig(val capture: List<String>, val ipv6: Boolean)

  companion object {
    private const val ACTION_STOP = "com.btsoftware.lockdown.NET_STOP"
    private const val SESSION_LABEL = "BT LOCKDOWN — Deep Work"
    private const val MTU = 1500
    // Private, non-routable tunnel addressing: nothing real is reachable through
    // it, which is the whole point.
    private const val TUNNEL_V4 = "10.111.111.1"
    private const val V4_PREFIX = 24
    private const val TUNNEL_V6 = "fd00:1111:1111::1"
    private const val V6_PREFIX = 64

    /**
     * True while our descriptor is open. A static flag rather than a binder: the
     * VPN service, the watchdog and the accessibility service all live in this
     * one process, and the manager must be able to answer "is the tunnel up?"
     * from any callback — including after the React layer is gone.
     */
    @Volatile
    var connected = false

    /**
     * The live instance, so a release can *guarantee* the network comes back.
     * `stop()` has to go through startService, and on Android 12+ a start from
     * the background can be refused — refusing to stop a block would be a bug a
     * student never forgives, so the descriptor is also closed directly here.
     */
    @Volatile
    private var instance: LockdownVpnService? = null

    /** Close the tunnel through the live instance (no IPC, no startService). */
    fun forceClose() {
      try {
        instance?.closeTunnel()
      } catch (_: Throwable) { }
    }

    /** @return true when the command could be delivered to the service. */
    fun start(ctx: Context): Boolean = send(ctx, null)

    fun stop(ctx: Context): Boolean = send(ctx, ACTION_STOP)

    /** Rebuild the tunnel: used when it is up but not actually enforcing. */
    fun restart(ctx: Context): Boolean {
      stop(ctx)
      return start(ctx)
    }
    /**
     * Plain startService, never startForegroundService: a VpnService is not a
     * foreground service and does not call startForeground(), so promoting it that
     * way would ANR the whole app on Android 12+ with
     * "Context did not call startForeground()". During a session the watchdog FGS
     * is up, which exempts us from the background-start limit; on a device-owner
     * device the always-on policy makes the OS start us instead. A refused start is
     * returned to the caller so the notification can say so honestly.
     */
    private fun send(ctx: Context, action: String?): Boolean {
      val i = Intent(ctx, LockdownVpnService::class.java)
      if (action != null) i.action = action
      return try {
        ctx.startService(i)
        true
      } catch (_: Throwable) {
        false
      }
    }
  }
}
