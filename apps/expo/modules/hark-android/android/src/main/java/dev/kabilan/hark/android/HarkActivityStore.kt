package dev.kabilan.hark.android

import android.content.Context

internal class HarkActivityStore(context: Context) {
  private val preferences = HarkPreferences(context.applicationContext)

  @Synchronized
  fun apply(activity: HarkEnvelope.Activity, nowMillis: Long = System.currentTimeMillis()): ActivityTransition {
    lateinit var transition: ActivityTransition
    preferences.updateActivity(activity.backendOrigin, activity.activityId) { current ->
      transition = ActivityReducer.reduce(
        current = current,
        sequence = activity.sequence,
        event = activity.event,
        expiresAtMillis = activity.expiresAtMillis,
        stateJson = activity.state.toString(),
        nowMillis = nowMillis,
      )
      transition.record
    }
    return transition
  }

  @Synchronized
  fun dismiss(backendOrigin: String, activityId: String): Boolean {
    var changed = false
    preferences.updateActivity(backendOrigin, activityId) { current ->
      if (current == null || current.dismissed) {
        current
      } else {
        changed = true
        current.copy(dismissed = true)
      }
    }
    return changed
  }

  @Synchronized
  fun expireIfCurrent(
    backendOrigin: String,
    activityId: String,
    sequence: Long,
    nowMillis: Long = System.currentTimeMillis(),
  ): Boolean {
    var expired = false
    preferences.updateActivity(backendOrigin, activityId) { current ->
      if (
        current == null ||
        current.terminal ||
        current.sequence != sequence ||
        current.expiresAtMillis > nowMillis
      ) {
        current
      } else {
        expired = true
        current.copy(terminal = true)
      }
    }
    return expired
  }

}
