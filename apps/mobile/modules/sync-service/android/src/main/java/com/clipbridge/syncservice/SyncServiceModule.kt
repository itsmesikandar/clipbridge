package com.clipbridge.syncservice

import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.net.NetworkInterface
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JavaScript API for the background sync service, battery settings and LAN interfaces. */
class SyncServiceModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SyncService")

    Function("start") { title: String, text: String ->
      val intent = Intent(context, SyncForegroundService::class.java)
        .putExtra(SyncForegroundService.EXTRA_TITLE, title)
        .putExtra(SyncForegroundService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
    }

    Function("update") { title: String, text: String ->
      if (SyncForegroundService.running) {
        SyncForegroundService.ensureChannel(context)
        context.getSystemService(NotificationManager::class.java).notify(
          SyncForegroundService.NOTIFICATION_ID,
          SyncForegroundService.buildNotification(context, title, text),
        )
      }
    }

    Function("stop") {
      context.stopService(Intent(context, SyncForegroundService::class.java))
    }

    Function("isRunning") { SyncForegroundService.running }

    /**
     * IPv4 addresses of all active interfaces with their prefix length. Unlike the Wi-Fi API,
     * this also sees the phone's own hotspot (ap0 / swlan0) and USB / Ethernet tethering.
     */
    Function("lanInterfaces") {
      val interfaces = NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
      interfaces
        .filter { it.isUp && !it.isLoopback }
        .flatMap { networkInterface ->
          networkInterface.interfaceAddresses
            .filter { it.address is Inet4Address }
            .map {
              mapOf(
                "name" to networkInterface.name,
                "address" to (it.address.hostAddress ?: ""),
                "prefix" to it.networkPrefixLength.toInt(),
              )
            }
        }
    }

    Function("isIgnoringBatteryOptimizations") {
      context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Opens the system screen where the user can let ClipBridge run in the background. */
    Function("openBatterySettings") {
      val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (_: Exception) {
        context.startActivity(fallback)
      }
    }
  }
}
