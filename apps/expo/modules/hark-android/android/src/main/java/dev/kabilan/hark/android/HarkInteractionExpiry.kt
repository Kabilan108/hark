package dev.kabilan.hark.android

import android.content.Context
import java.security.MessageDigest

internal enum class InteractionExpiryDecision {
  WAIT,
  CANCEL,
  IGNORE,
}

internal object InteractionExpiryReducer {
  fun decide(
    currentIdentity: String?,
    expectedIdentity: String,
    expiresAtMillis: Long,
    nowMillis: Long,
  ): InteractionExpiryDecision = when {
    currentIdentity != expectedIdentity -> InteractionExpiryDecision.IGNORE
    expiresAtMillis > nowMillis -> InteractionExpiryDecision.WAIT
    else -> InteractionExpiryDecision.CANCEL
  }
}

internal class HarkInteractionExpiryStore(context: Context) {
  private val preferences = HarkPreferences(context.applicationContext)

  fun track(notificationTag: String, interaction: Interaction): String {
    val identity = identity(interaction.id, interaction.actionDigest)
    preferences.setInteractionIdentity(notificationTag, identity)
    return identity
  }

  fun currentIdentity(notificationTag: String): String? =
    preferences.interactionIdentity(notificationTag)

  fun clear(notificationTag: String) {
    preferences.setInteractionIdentity(notificationTag, null)
  }

  fun clearIfCurrent(notificationTag: String, expectedIdentity: String): Boolean =
    preferences.clearInteractionIdentityIfCurrent(notificationTag, expectedIdentity)

  companion object {
    fun identity(interactionId: String, actionDigest: String): String =
      MessageDigest.getInstance("SHA-256")
        .digest("$interactionId\u0000$actionDigest".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
  }
}
