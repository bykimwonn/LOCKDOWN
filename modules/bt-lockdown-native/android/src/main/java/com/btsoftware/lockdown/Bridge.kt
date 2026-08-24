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
 *  - overlayDenied                      SYSTEM_ALERT_WINDOW permission missing
 *  - heartbeatLost                      N consecutive failed heartbeats
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
      val bundle = Arguments.createBundle()
      bundle.putString("event", event)
      data.forEach { (k, v) -> bundle.putString(k, v?.toString()) }
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_CHANNEL, bundle)
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
