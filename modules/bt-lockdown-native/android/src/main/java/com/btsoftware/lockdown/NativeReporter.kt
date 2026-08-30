package com.btsoftware.lockdown

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Durable violation reporting (Tier 1 #5).
 *
 * Bridge.emit() drops events whenever the React process is gone — which
 * is exactly when the watchdog keeps enforcing (blocked launches after a
 * force-quit, accessibility switched off, device admin removed). Those
 * events used to die with JS, so penalties were never recorded.
 *
 * report() always tries the JS bridge first (JS owns the outbox and
 * penalty UI). When JS is dead it queues the event in prefs as raw
 * server JSON and posts it straight to POST /api/lockdown/event from
 * the worker thread. Queued events survive reboots and are flushed by
 * every watchdog tick until the server accepts them. Every event
 * carries a client_event_id so a server-side dedupe can absorb a
 * double-report if JS reattaches between queue and flush.
 */
object NativeReporter {

  private const val KEY_QUEUE = "eventQueue"

  /**
   * Report one violation.
   *
   * @param jsEvent event name JS understands (blocked / accessibilityOff / adminDisabled)
   * @param serverEventType one of: block_attempt | force_quit | tamper_detected
   * @param detail human-readable reason (maps to the server's `reason`)
   * @param app package name for block_attempt events (maps to `app_name`)
   */
  fun report(
    context: Context,
    jsEvent: String,
    serverEventType: String,
    detail: String,
    app: String? = null
  ) {
    // 1. Try JS first — it owns the outbox + penalty UX.
    if (Bridge.jsAlive()) {
      val data = if (app != null) mapOf("app" to app) else emptyMap()
      Bridge.emit(jsEvent, data)
      return
    }

    // 2. JS is dead (force-quit / never restarted after reboot). Queue and
    //    post natively so the violation is still recorded.
    val prefs = context.getSharedPreferences(LockdownOverlayService.PREFS, Context.MODE_PRIVATE)
    val apiBase = (prefs.getString("apiBase", "") ?: "").trimEnd('/')
    val token = prefs.getString("token", "") ?: ""
    val sessionId = prefs.getString("sessionId", "") ?: ""

    val body = JSONObject().apply {
      put("event_type", serverEventType)
      put("app_name", app ?: "")
      put("device_platform", "android")
      put("reason", detail)
      put("client_event_id", "native_" + UUID.randomUUID().toString())
      if (sessionId.isNotEmpty()) put("session_id", sessionId)
    }

    enqueue(prefs, body.toString())
    if (apiBase.isNotEmpty() && token.isNotEmpty()) {
      flush(context, apiBase, token)
    }
  }

  /** Flush the queue. Called on the watchdog worker thread every tick. */
  fun flush(context: Context, apiBase: String, token: String) {
    val prefs = context.getSharedPreferences(LockdownOverlayService.PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_QUEUE, "") ?: ""
    if (raw.isEmpty()) return

    val queue = try { JSONArray(raw) } catch (_: Throwable) { JSONArray() }
    var i = 0
    while (i < queue.length()) {
      val item = queue.optString(i, "")
      if (item.isEmpty()) { queue.remove(i); continue }
      val status = post("$apiBase/api/lockdown/event", token, item)
      if (status == null) {
        // network failure — keep this item and everything after (FIFO order)
        break
      }
      queue.remove(i)
      if (status == 401 || status == 403) {
        // dead token — the watchdog self-cleans soon; leave the rest queued
        // for after re-login rather than hammering the server.
        break
      }
      // 2xx accepted, or 400 (bad payload) — move on
    }

    val remaining = StringBuilder("[")
    var first = true
    for (j in 0 until queue.length()) {
      val v = queue.optString(j, "")
      if (v.isEmpty()) continue
      if (!first) remaining.append(",")
      remaining.append(JSONObject.quote(v))
      first = false
    }
    remaining.append("]")
    prefs.edit().putString(KEY_QUEUE, remaining.toString()).apply()
  }

  private fun enqueue(prefs: android.content.SharedPreferences, item: String) {
    val raw = prefs.getString(KEY_QUEUE, "[]") ?: "[]"
    val arr = try { JSONArray(raw) } catch (_: Throwable) { JSONArray() }
    arr.put(item)
    // cap: never let a long dead-token period grow prefs without bound
    val trimmed = if (arr.length() > 100) {
      val capped = JSONArray()
      for (i in (arr.length() - 100) until arr.length()) capped.put(arr.optString(i))
      capped
    } else arr
    prefs.edit().putString(KEY_QUEUE, trimmed.toString()).apply()
  }

  private fun post(url: String, token: String, body: String): Int? {
    return try {
      val c = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 8000
        readTimeout = 8000
        requestMethod = "POST"
        setRequestProperty("Authorization", "Bearer $token")
        setRequestProperty("Accept", "application/json")
        setRequestProperty("Content-Type", "application/json")
        doOutput = true
        outputStream.use { it.write(body.toByteArray()) }
      }
      val code = c.responseCode
      (if (code in 200..299) c.inputStream else c.errorStream)?.close()
      c.disconnect()
      code
    } catch (_: Throwable) {
      null
    }
  }
}
