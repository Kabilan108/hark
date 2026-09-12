package dev.kabilan.hark.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

internal class HarkAndroidConfiguration : Record {
  @Field
  var backendOrigin: String = ""

  @Field
  var deviceId: String? = null
}

class HarkAndroidModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HarkAndroid")

    AsyncFunction("configure") { configuration: HarkAndroidConfiguration ->
      val context = appContext.reactContext ?: error("React context is unavailable")
      val origin = HarkUrlPolicy.normalizeHttpsOrigin(configuration.backendOrigin)
        ?: throw IllegalArgumentException("backendOrigin must be an HTTPS origin")
      HarkDeliveryCoordinator.coordinated {
        val preferences = HarkPreferences(context)
        val previousOrigin = preferences.backendOrigin
        preferences.apply {
          backendOrigin = origin
          deviceId = configuration.deviceId?.trim()?.takeIf(String::isNotEmpty)
        }
        if (
          (previousOrigin != null && previousOrigin != origin) ||
          configuration.deviceId.isNullOrBlank()
        ) {
          preferences.clearActivityRecords()
          preferences.clearInteractionRecords()
          HarkWork.cancelAll(context)
          NotificationManagerCompat.from(context).cancelAll()
        }
      }
      HarkNotificationRenderer(context)
      Unit
    }

    AsyncFunction("getFcmToken") { promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.reject("ERR_CONTEXT_UNAVAILABLE", "React context is unavailable", null)
        return@AsyncFunction
      }
      FirebaseMessaging.getInstance().token
        .addOnSuccessListener { token ->
          HarkPreferences(context).fcmToken = token
          promise.resolve(token)
        }
        .addOnFailureListener { error ->
          promise.reject("ERR_FCM_TOKEN", "Unable to obtain the FCM token", error)
        }
    }

    AsyncFunction("getSettings") {
      val context = appContext.reactContext ?: error("React context is unavailable")
      val manager = NotificationManagerCompat.from(context)
      val permissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
      mapOf(
        "notificationsEnabled" to (permissionGranted && manager.areNotificationsEnabled()),
        "promotionEnabled" to manager.canPostPromotedNotifications(),
        "promotionSupported" to (Build.VERSION.SDK_INT >= 36),
        "watchedActivitiesEnabled" to HarkPreferences(context).watchedActivitiesEnabled,
      )
    }

    AsyncFunction("setWatchedActivitiesEnabled") { enabled: Boolean ->
      val context = appContext.reactContext ?: error("React context is unavailable")
      HarkPreferences(context).watchedActivitiesEnabled = enabled
    }

    AsyncFunction("openNotificationSettings") {
      val context = appContext.reactContext ?: error("React context is unavailable")
      val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("openPromotedNotificationSettings") {
      val context = appContext.reactContext ?: error("React context is unavailable")
      val promotionIntent = Intent(ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val intent = if (promotionIntent.resolveActivity(context.packageManager) != null) {
        promotionIntent
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }
  }

  companion object {
    private const val ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS =
      "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS"
  }
}
