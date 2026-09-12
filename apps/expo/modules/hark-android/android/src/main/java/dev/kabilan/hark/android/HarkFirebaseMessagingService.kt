package dev.kabilan.hark.android

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class HarkFirebaseMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    HarkPreferences(this).fcmToken = token
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val raw = remoteMessage.data[DATA_KEY] ?: return
    val envelope = HarkProtocol.parse(raw) ?: return
    HarkDeliveryCoordinator.coordinated {
      val preferences = HarkPreferences(this)
      if (
        preferences.deviceId != envelope.targetDeviceId ||
        preferences.backendOrigin != envelope.backendOrigin
      ) {
        return@coordinated
      }
      when (envelope) {
        is HarkEnvelope.Notification -> HarkNotificationRenderer(this).showNotification(envelope)
        is HarkEnvelope.Withdrawal -> {
          HarkNotificationRenderer(this).cancelEvent(envelope.backendOrigin, envelope.eventId)
        }
        is HarkEnvelope.Activity -> handleActivity(envelope)
      }
    }
  }

  private fun handleActivity(activity: HarkEnvelope.Activity) {
    val renderer = HarkNotificationRenderer(this)
    val transition = HarkActivityStore(this).apply(activity)
    when (transition.decision) {
      ActivityDecision.RENDER -> {
        renderer.showActivity(activity)
        HarkWork.scheduleExpiry(this, activity)
      }
      ActivityDecision.CANCEL -> {
        val delay = activity.dismissAfterSeconds
        if (
          !transition.record.dismissed &&
          activity.event == ActivityEvent.END &&
          delay != null &&
          delay > 0
        ) {
          renderer.showActivity(activity, terminal = true)
          HarkWork.scheduleTerminalRemoval(this, activity, delay)
        } else {
          renderer.cancelActivity(activity.backendOrigin, activity.activityId)
        }
      }
      ActivityDecision.IGNORE -> Unit
    }
  }

  companion object {
    private const val DATA_KEY = "hark"
  }
}
