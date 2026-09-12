package dev.kabilan.hark.android

import org.json.JSONArray
import org.json.JSONObject

internal sealed interface HarkEnvelope {
  val backendOrigin: String
  val targetDeviceId: String

  data class Notification(
    override val backendOrigin: String,
    override val targetDeviceId: String,
    val eventId: String,
    val title: String,
    val body: String,
    val deepLink: String?,
    val interaction: Interaction?,
  ) : HarkEnvelope

  data class Withdrawal(
    override val backendOrigin: String,
    override val targetDeviceId: String,
    val eventId: String,
  ) : HarkEnvelope

  data class Activity(
    override val backendOrigin: String,
    override val targetDeviceId: String,
    val activityId: String,
    val sequence: Long,
    val event: ActivityEvent,
    val state: JSONObject,
    val expiresAtMillis: Long,
    val dismissAfterSeconds: Long?,
    val deepLink: String?,
  ) : HarkEnvelope
}

internal enum class ActivityEvent {
  START,
  UPDATE,
  END,
}

internal data class Interaction(
  val id: String,
  val kind: String,
  val actionDigest: String,
  val responseToken: String?,
  val responseUrl: String,
  val expiresAtMillis: Long?,
  val deviceId: String?,
  val deliveryId: String?,
  val credential: String?,
  val actions: List<InteractionAction>,
)

internal data class InteractionAction(
  val id: String,
  val title: String,
  val destructive: Boolean,
)

internal object HarkProtocol {
  fun parse(raw: String): HarkEnvelope? = runCatching {
    val json = JSONObject(raw)
    if (json.optInt("v", -1) != 1) return null
    val backendOrigin = normalizedOrigin(json.requireNonBlank("backendOrigin")) ?: return null
    val targetDeviceId = json.requireNonBlank("targetDeviceId")?.takeIf { it.length <= 100 }
      ?: return null
    when (json.requireNonBlank("kind")) {
      "notification" -> {
        val eventId = json.requireNonBlank("eventId") ?: return null
        val title = json.requireNonBlank("title") ?: return null
        val body = json.optString("body").trim().take(4_000)
        HarkEnvelope.Notification(
          backendOrigin = backendOrigin,
          targetDeviceId = targetDeviceId,
          eventId = eventId,
          title = title.take(160),
          body = body,
          deepLink = safeDeepLink(json.optNullableString("deepLink") ?: json.optNullableString("url")),
          interaction = json.optJSONObject("interaction")?.let {
            parseInteraction(it, backendOrigin, liveActivity = false)
          },
        )
      }

      "notification.withdraw" -> HarkEnvelope.Withdrawal(
        backendOrigin = backendOrigin,
        targetDeviceId = targetDeviceId,
        eventId = json.requireNonBlank("eventId") ?: return null,
      )

      "activity" -> {
        val activityId = json.requireNonBlank("activityId") ?: return null
        val sequence = json.optLong("sequence", -1)
        if (sequence < 0) return null
        val event = when (json.requireNonBlank("event")) {
          "start" -> ActivityEvent.START
          "update" -> ActivityEvent.UPDATE
          "end" -> ActivityEvent.END
          else -> return null
        }
        val state = json.optJSONObject("state") ?: return null
        val expiresAt = parseInstant(json.requireNonBlank("expiresAt")) ?: return null
        HarkEnvelope.Activity(
          backendOrigin = backendOrigin,
          targetDeviceId = targetDeviceId,
          activityId = activityId,
          sequence = sequence,
          event = event,
          state = state,
          expiresAtMillis = expiresAt,
          dismissAfterSeconds = if (json.has("dismissAfterSeconds")) {
            json.optLong("dismissAfterSeconds").coerceIn(0, 86_400)
          } else {
            null
          },
          deepLink = safeDeepLink(
            json.optNullableString("deepLink")
              ?: state.optNullableString("deepLink")
              ?: state.optNullableString("url"),
          ),
        )
      }

      else -> null
    }
  }.getOrNull()

  fun activityInteraction(activity: HarkEnvelope.Activity): Interaction? =
    activity.state.optJSONObject("interaction")?.let {
      if (it.optString("state", "pending") != "pending") null
      else parseInteraction(it, activity.backendOrigin, liveActivity = true)
    }

  private fun parseInteraction(
    json: JSONObject,
    backendOrigin: String,
    liveActivity: Boolean,
  ): Interaction? {
    val id = json.requireNonBlank("id") ?: json.requireNonBlank("interactionId") ?: return null
    val kind = json.requireNonBlank("kind") ?: return null
    if (kind !in setOf("approval", "yes_no", "reply")) return null
    if (liveActivity && kind == "reply") return null
    val actionDigest = json.requireNonBlank("actionDigest") ?: return null
    if (!ACTION_DIGEST.matches(actionDigest)) return null
    val responseToken = json.optNullableString("responseToken")
    val credential = json.optNullableString("credential")
    val deviceId = json.optNullableString("deviceId")
    val deliveryId = json.optNullableString("deliveryId")
    val expiresAtMillis = parseInstant(json.optNullableString("expiresAt"))
    val defaultPath = if (liveActivity) {
      "/api/live-activity-interactions/$id/respond"
    } else {
      "/api/interaction-responses/$id/respond"
    }
    val responseUrl = json.optNullableString("responseUrl") ?: "$backendOrigin$defaultPath"
    if (!isSameBackendApi(responseUrl, backendOrigin)) return null
    if (liveActivity) {
      if (
        credential?.matches(RESPONSE_TOKEN) != true ||
        deviceId.isNullOrBlank() ||
        deliveryId.isNullOrBlank() ||
        expiresAtMillis == null
      ) {
        return null
      }
    } else if (responseToken?.matches(RESPONSE_TOKEN) != true) {
      return null
    }
    return Interaction(
      id = id,
      kind = kind,
      actionDigest = actionDigest,
      responseToken = responseToken,
      responseUrl = responseUrl,
      expiresAtMillis = expiresAtMillis,
      deviceId = deviceId,
      deliveryId = deliveryId,
      credential = credential,
      actions = parseActions(json.optJSONArray("actions")).ifEmpty {
        buildList {
          val primaryAction = json.optNullableString("primaryAction")
          val primaryLabel = json.optNullableString("primaryLabel")
          if (primaryAction != null && primaryLabel != null) {
            add(InteractionAction(primaryAction.take(32), primaryLabel.take(24), false))
          }
          val secondaryAction = json.optNullableString("secondaryAction")
          val secondaryLabel = json.optNullableString("secondaryLabel")
          if (secondaryAction != null && secondaryLabel != null) {
            add(InteractionAction(secondaryAction.take(32), secondaryLabel.take(24), true))
          }
        }
      },
    )
  }

  private fun parseActions(array: JSONArray?): List<InteractionAction> {
    if (array == null) return emptyList()
    return buildList {
      for (index in 0 until minOf(array.length(), 4)) {
        val item = array.optJSONObject(index) ?: continue
        val id = item.requireNonBlank("id") ?: continue
        val title = item.requireNonBlank("title") ?: continue
        add(InteractionAction(id.take(32), title.take(24), item.optBoolean("destructive", false)))
      }
    }
  }

  private fun normalizedOrigin(raw: String?): String? {
    val uri = raw?.let(android.net.Uri::parse) ?: return null
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) return null
    return uri.buildUpon().path(null).query(null).fragment(null).build().toString().trimEnd('/')
  }

  private fun isSameBackendApi(url: String, backendOrigin: String): Boolean {
    val target = android.net.Uri.parse(url)
    val backend = android.net.Uri.parse(backendOrigin)
    return target.scheme == "https" &&
      target.scheme == backend.scheme &&
      target.authority == backend.authority &&
      target.path?.startsWith("/api/") == true &&
      target.userInfo == null &&
      target.fragment == null
  }

  private fun safeDeepLink(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val uri = android.net.Uri.parse(value)
    return if (uri.scheme in setOf("https", "http", "hark-android") && uri.userInfo == null) value else null
  }

  private fun parseInstant(value: String?): Long? = value?.let {
    runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull()
  }

  private fun JSONObject.requireNonBlank(key: String): String? =
    optString(key).trim().takeIf(String::isNotEmpty)

  private fun JSONObject.optNullableString(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).trim().takeIf(String::isNotEmpty) else null

  private val ACTION_DIGEST = Regex("^[a-f0-9]{64}$")
  private val RESPONSE_TOKEN = Regex("^[A-Za-z0-9_-]{43}$")
}
