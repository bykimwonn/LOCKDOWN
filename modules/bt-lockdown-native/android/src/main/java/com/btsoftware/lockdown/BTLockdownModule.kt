package com.btsoftware.lockdown

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/**
 * JS bridge for Android enforcement.
 * The actual intercept lives in [LockdownAccessibilityService].
 */
class BTLockdownModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "BTLockdownModule"

  @ReactMethod
  fun requestAccessibility(promise: Promise) {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    ctx.startActivity(intent)
    promise.resolve(isAccessibilityEnabled())
  }

  @ReactMethod
  fun requestOverlay(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${ctx.packageName}")
      ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
      ctx.startActivity(intent)
    }
    promise.resolve(
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)
    )
  }

  @ReactMethod
  fun requestScreenTimeAuthorization(promise: Promise) {
    promise.resolve(false)
  }

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    val map = Arguments.createMap()
    map.putString("screenTime", "unavailable")
    map.putString("accessibility", if (isAccessibilityEnabled()) "granted" else "denied")
    map.putString(
      "overlay",
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)) "granted" else "denied"
    )
    map.putString("notifications", "pending")
    promise.resolve(map)
  }

  @ReactMethod
  fun activate(payload: ReadableMap, promise: Promise) {
    val prefs = ctx.getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
    val blocked = payload.getArray("blockedPackages")?.toArrayList()?.joinToString(",") ?: ""
    val white = payload.getArray("whitelistPackages")?.toArrayList()?.joinToString(",") ?: ""
    prefs.edit()
      .putBoolean("active", true)
      .putString("sessionId", payload.getString("sessionId"))
      .putString("endsAt", payload.getString("endsAt"))
      .putString("blocked", blocked)
      .putString("whitelist", white)
      .apply()
    LockdownOverlayService.start(ctx)
    promise.resolve(true)
  }

  @ReactMethod
  fun deactivate(promise: Promise) {
    ctx.getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
      .edit().putBoolean("active", false).apply()
    LockdownOverlayService.stop(ctx)
    promise.resolve(true)
  }

  @ReactMethod
  fun isEnforcing(promise: Promise) {
    val active = ctx.getSharedPreferences("bt.lockdown", Context.MODE_PRIVATE)
      .getBoolean("active", false)
    promise.resolve(active && isAccessibilityEnabled())
  }

  private fun isAccessibilityEnabled(): Boolean {
    val am = ctx.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    val list = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
    val me = ComponentName(ctx, LockdownAccessibilityService::class.java).flattenToString()
    return list.any { it.resolveInfo.serviceInfo.let { s -> ComponentName(s.packageName, s.name).flattenToString() } == me }
  }
}
