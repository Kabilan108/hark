package dev.kabilan.hark.android

import android.content.Context
import android.content.SharedPreferences
import java.security.MessageDigest
import org.json.JSONObject

internal class HarkPreferences(context: Context) {
  private val preferences: SharedPreferences =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  var backendOrigin: String?
    get() = preferences.getString(KEY_BACKEND_ORIGIN, null)
    set(value) {
      preferences.edit().apply {
        if (value == null) remove(KEY_BACKEND_ORIGIN) else putString(KEY_BACKEND_ORIGIN, value)
      }.apply()
    }

  var deviceId: String?
    get() = preferences.getString(KEY_DEVICE_ID, null)
    set(value) {
      preferences.edit().apply {
        if (value == null) remove(KEY_DEVICE_ID) else putString(KEY_DEVICE_ID, value)
      }.apply()
    }

  var fcmToken: String?
    get() = preferences.getString(KEY_FCM_TOKEN, null)
    set(value) {
      preferences.edit().apply {
        if (value == null) remove(KEY_FCM_TOKEN) else putString(KEY_FCM_TOKEN, value)
      }.apply()
    }

  var watchedActivitiesEnabled: Boolean
    get() = preferences.getBoolean(KEY_WATCHED_ACTIVITIES, false)
    set(value) {
      preferences.edit().putBoolean(KEY_WATCHED_ACTIVITIES, value).apply()
    }

  fun activityRecord(backendOrigin: String, activityId: String): ActivityRecord? =
    synchronized(ACTIVITY_LOCK) {
      val raw = preferences.getString(activityKey(backendOrigin, activityId), null)
        ?: return@synchronized null
      runCatching {
        val json = JSONObject(raw)
        ActivityRecord(
          sequence = json.getLong("sequence"),
          terminal = json.getBoolean("terminal"),
          dismissed = json.getBoolean("dismissed"),
          expiresAtMillis = json.getLong("expiresAtMillis"),
          stateJson = json.getString("stateJson"),
        )
      }.getOrNull()
    }

  fun updateActivity(
    backendOrigin: String,
    activityId: String,
    transform: (ActivityRecord?) -> ActivityRecord?,
  ): ActivityRecord? = synchronized(ACTIVITY_LOCK) {
      val key = activityKey(backendOrigin, activityId)
      val next = transform(activityRecord(backendOrigin, activityId))
      preferences.edit().apply {
        if (next == null) {
          remove(key)
        } else {
          putString(
            key,
            JSONObject()
              .put("sequence", next.sequence)
              .put("terminal", next.terminal)
              .put("dismissed", next.dismissed)
              .put("expiresAtMillis", next.expiresAtMillis)
              .put("stateJson", next.stateJson)
              .toString(),
          )
        }
      }.apply()
      next
    }

  fun clearActivityRecords() {
    synchronized(ACTIVITY_LOCK) {
      val editor = preferences.edit()
      preferences.all.keys
        .filter { it.startsWith("activity.") }
        .forEach(editor::remove)
      editor.apply()
    }
  }

  fun interactionIdentity(notificationTag: String): String? =
    synchronized(INTERACTION_LOCK) {
      preferences.getString(interactionKey(notificationTag), null)
    }

  fun setInteractionIdentity(notificationTag: String, identity: String?) {
    synchronized(INTERACTION_LOCK) {
      preferences.edit().apply {
        if (identity == null) remove(interactionKey(notificationTag))
        else putString(interactionKey(notificationTag), identity)
      }.apply()
    }
  }

  fun clearInteractionIdentityIfCurrent(notificationTag: String, expectedIdentity: String): Boolean =
    synchronized(INTERACTION_LOCK) {
      val key = interactionKey(notificationTag)
      if (preferences.getString(key, null) != expectedIdentity) return@synchronized false
      preferences.edit().remove(key).apply()
      true
    }

  fun clearInteractionRecords() {
    synchronized(INTERACTION_LOCK) {
      val editor = preferences.edit()
      preferences.all.keys
        .filter { it.startsWith(INTERACTION_PREFIX) }
        .forEach(editor::remove)
      editor.apply()
    }
  }

  companion object {
    private const val PREFERENCES_NAME = "hark.android.v1"
    private const val KEY_BACKEND_ORIGIN = "configuration.backendOrigin"
    private const val KEY_DEVICE_ID = "configuration.deviceId"
    private const val KEY_FCM_TOKEN = "messaging.fcmToken"
    private const val KEY_WATCHED_ACTIVITIES = "activities.watchedEnabled"
    private const val INTERACTION_PREFIX = "interaction."
    private val ACTIVITY_LOCK = Any()
    private val INTERACTION_LOCK = Any()

    fun activityKey(backendOrigin: String, activityId: String): String {
      val bytes = MessageDigest.getInstance("SHA-256")
        .digest("$backendOrigin\u0000$activityId".toByteArray(Charsets.UTF_8))
      return "activity." + bytes.joinToString("") { "%02x".format(it) }
    }

    private fun interactionKey(notificationTag: String): String =
      INTERACTION_PREFIX + MessageDigest.getInstance("SHA-256")
        .digest(notificationTag.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
  }
}
