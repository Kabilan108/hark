package dev.kabilan.hark.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

class HarkActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_UNPIN -> handleUnpin(context, intent)
      ACTION_RESPONSE -> handleResponse(context, intent)
    }
  }

  private fun handleUnpin(context: Context, intent: Intent) {
    val preferences = HarkPreferences(context)
    if (preferences.deviceId.isNullOrBlank()) return
    val origin = intent.getStringExtra(EXTRA_BACKEND_ORIGIN) ?: return
    val activityId = intent.getStringExtra(EXTRA_ACTIVITY_ID) ?: return
    if (HarkUrlPolicy.normalizeHttpsOrigin(origin) != origin) return
    if (preferences.backendOrigin != origin) return
    HarkDeliveryCoordinator.coordinated {
      HarkActivityStore(context).dismiss(origin, activityId)
      HarkNotificationRenderer(context).cancelActivity(origin, activityId)
    }
  }

  private fun handleResponse(context: Context, intent: Intent) {
    val preferences = HarkPreferences(context)
    val configuredDeviceId = preferences.deviceId ?: return
    val origin = intent.getStringExtra(EXTRA_BACKEND_ORIGIN) ?: return
    val responseUrl = intent.getStringExtra(EXTRA_RESPONSE_URL) ?: return
    val interactionId = intent.getStringExtra(EXTRA_INTERACTION_ID) ?: return
    val interactionKind = intent.getStringExtra(EXTRA_INTERACTION_KIND) ?: return
    val action = intent.getStringExtra(EXTRA_ACTION) ?: return
    val actionDigest = intent.getStringExtra(EXTRA_ACTION_DIGEST) ?: return
    val notificationTag = intent.getStringExtra(EXTRA_NOTIFICATION_TAG) ?: return
    val expiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, -1L).takeIf { it >= 0 }
    val embeddedDeviceId = intent.getStringExtra(EXTRA_DEVICE_ID)
    if (embeddedDeviceId != null && embeddedDeviceId != configuredDeviceId) return
    val deviceId = configuredDeviceId
    if (HarkUrlPolicy.normalizeHttpsOrigin(origin) != origin) return
    if (preferences.backendOrigin != origin) return
    if (!HarkUrlPolicy.isSameBackendApi(responseUrl, origin)) return
    if (!ACTION_DIGEST.matches(actionDigest) || !validAction(interactionKind, action)) return
    if (expiresAt?.let { it <= System.currentTimeMillis() } == true) {
      clearExpiredNotification(context, notificationTag, interactionId, actionDigest)
      return
    }
    val response = if (action == "reply") {
      RemoteInput.getResultsFromIntent(intent)
        ?.getCharSequence(REMOTE_INPUT_KEY)
        ?.toString()
        ?.trim()
        ?.takeIf(String::isNotEmpty)
        ?.take(4_000)
        ?: return
    } else {
      null
    }
    val responseToken = intent.getStringExtra(EXTRA_RESPONSE_TOKEN)
    val deliveryId = intent.getStringExtra(EXTRA_DELIVERY_ID)
    val credential = intent.getStringExtra(EXTRA_CREDENTIAL)
    val ordinaryValid = responseToken?.matches(RESPONSE_TOKEN) == true
    val liveValid = deliveryId?.isNotBlank() == true && credential?.matches(RESPONSE_TOKEN) == true
    if (!ordinaryValid && !liveValid) return

    HarkWork.enqueueResponse(
      context,
      HarkResponseRequest(
        backendOrigin = origin,
        responseUrl = responseUrl,
        interactionId = interactionId,
        action = action,
        actionDigest = actionDigest,
        response = response,
        deviceId = deviceId,
        responseToken = responseToken,
        deliveryId = deliveryId,
        credential = credential,
        expiresAtMillis = expiresAt,
        notificationTag = notificationTag,
      ),
    )
  }

  private fun validAction(kind: String, action: String): Boolean = when (kind) {
    "approval" -> action == "approve" || action == "deny"
    "yes_no" -> action == "yes" || action == "no"
    "reply" -> action == "reply"
    else -> false
  }

  private fun clearExpiredNotification(
    context: Context,
    notificationTag: String,
    interactionId: String,
    actionDigest: String,
  ) {
    HarkDeliveryCoordinator.coordinated {
      val store = HarkInteractionExpiryStore(context)
      val identity = HarkInteractionExpiryStore.identity(interactionId, actionDigest)
      if (store.currentIdentity(notificationTag) in setOf(null, identity)) {
        store.clear(notificationTag)
        HarkWork.cancelInteractionExpiry(context, notificationTag)
        HarkNotificationRenderer(context).cancel(notificationTag)
      }
    }
  }

  companion object {
    const val ACTION_RESPONSE = "dev.kabilan.hark.android.RESPONSE"
    const val ACTION_UNPIN = "dev.kabilan.hark.android.UNPIN"
    const val REMOTE_INPUT_KEY = "hark.reply"
    const val EXTRA_BACKEND_ORIGIN = "backendOrigin"
    const val EXTRA_ACTIVITY_ID = "activityId"
    const val EXTRA_INTERACTION_ID = "interactionId"
    const val EXTRA_INTERACTION_KIND = "interactionKind"
    const val EXTRA_ACTION = "action"
    const val EXTRA_ACTION_DIGEST = "actionDigest"
    const val EXTRA_RESPONSE_TOKEN = "responseToken"
    const val EXTRA_RESPONSE_URL = "responseUrl"
    const val EXTRA_EXPIRES_AT = "expiresAt"
    const val EXTRA_DEVICE_ID = "deviceId"
    const val EXTRA_DELIVERY_ID = "deliveryId"
    const val EXTRA_CREDENTIAL = "credential"
    const val EXTRA_NOTIFICATION_TAG = "notificationTag"

    private val ACTION_DIGEST = Regex("^[a-f0-9]{64}$")
    private val RESPONSE_TOKEN = Regex("^[A-Za-z0-9_-]{43}$")
  }
}
