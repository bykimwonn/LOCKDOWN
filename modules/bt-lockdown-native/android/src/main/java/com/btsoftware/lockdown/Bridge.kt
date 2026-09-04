package com.btsoftware.lockdown

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Single channel between the native enforcement layer and React.
 * JS subscribes to "bt.lockdown.event" and reads the `event` field.
 *
 * Events:
 *  - blocked              (app=package)   a blocked app was intercepted
 *  - expired                            server end time reached, watchdog cleaned up
 *  - serverInactive                     server says the session is over
 *  - unauthorized                       token rejected (expired / unbound)
 *  - accessibilityOff                   user disabled the accessibility service
 *  - a11yRestored                       the seal service got bound again
 *  - overlayDenied                      SYSTEM_ALERT_WINDOW permission missing
 *  - heartbeatLost                      N consecutive failed heartbeats
 *  - netProtectActive                   network shield verified enforcing
 *  - netProtectDegraded                 tunnel up but routing says it is not
 *  - netProtectDown                     establish() keeps failing (technical)
 *  - netRevoked    (reason=…)            the VPN was disconnected on the device
 *  - netShieldOff                        shield turned off mid-session (JS alias)
 */
object Bridge {

  @Volatile
  var reactContext: ReactApplicationContext? = null

  fun attach(context: ReactApplicationContext) {
    reactContext = context
  }

  fun emit(event: String, data: Map<String, Any?> = emptyMap()) {
    val ctx = reactContext ?: return
    if (!ctx.hasActiveCatalystInstance()) return
    try {
      val map = Arguments.createMap()
      map.putString("event", event)
      data.forEach { (k, v) -> map.putString(k, v?.toString()) }
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_CHANNEL, map)
    } catch (_: Throwable) {
      // bridge may be mid-teardown; enforcement keeps working regardless
    }
  }

  fun jsAlive(): Boolean {
    val ctx = reactContext ?: return false
    return try {
      ctx.hasActiveCatalystInstance()
    } catch (_: Throwable) {
      false
    }
  }

  const val EVENT_CHANNEL = "bt.lockdown.event"
}
