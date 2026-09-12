package dev.kabilan.hark.android

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

internal data class HarkResponseRequest(
  val backendOrigin: String,
  val responseUrl: String,
  val interactionId: String,
  val action: String,
  val actionDigest: String,
  val response: String?,
  val deviceId: String,
  val responseToken: String?,
  val deliveryId: String?,
  val credential: String?,
  val expiresAtMillis: Long?,
  val notificationTag: String,
) {
  val identity: String
    get() = "$backendOrigin\u0000$interactionId"

  fun toJson(): JSONObject = JSONObject()
    .put("backendOrigin", backendOrigin)
    .put("responseUrl", responseUrl)
    .put("interactionId", interactionId)
    .put("action", action)
    .put("actionDigest", actionDigest)
    .put("response", response)
    .put("deviceId", deviceId)
    .put("responseToken", responseToken)
    .put("deliveryId", deliveryId)
    .put("credential", credential)
    .put("expiresAtMillis", expiresAtMillis)
    .put("notificationTag", notificationTag)

  fun requestBody(): JSONObject = JSONObject()
    .put("action", action)
    .put("actionDigest", actionDigest)
    .put("deviceId", deviceId)
    .apply {
      response?.let { put("response", it) }
      responseToken?.let { put("responseToken", it) }
      deliveryId?.let { put("deliveryId", it) }
      credential?.let { put("credential", it) }
    }

  companion object {
    fun fromJson(raw: String): HarkResponseRequest? = runCatching {
      val json = JSONObject(raw)
      HarkResponseRequest(
        backendOrigin = json.getString("backendOrigin"),
        responseUrl = json.getString("responseUrl"),
        interactionId = json.getString("interactionId"),
        action = json.getString("action"),
        actionDigest = json.getString("actionDigest"),
        response = json.optNullableString("response"),
        deviceId = json.getString("deviceId"),
        responseToken = json.optNullableString("responseToken"),
        deliveryId = json.optNullableString("deliveryId"),
        credential = json.optNullableString("credential"),
        expiresAtMillis = if (json.has("expiresAtMillis") && !json.isNull("expiresAtMillis")) {
          json.getLong("expiresAtMillis")
        } else {
          null
        },
        notificationTag = json.getString("notificationTag"),
      )
    }.getOrNull()

    private fun JSONObject.optNullableString(key: String): String? =
      if (has(key) && !isNull(key)) getString(key) else null
  }
}

internal class HarkResponseWorker(
  appContext: Context,
  workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {
  override fun doWork(): Result {
    val request = inputData.getString(KEY_REQUEST)?.let(HarkResponseRequest::fromJson)
      ?: return Result.failure()
    val preferences = HarkPreferences(applicationContext)
    if (
      preferences.deviceId != request.deviceId ||
      preferences.backendOrigin != request.backendOrigin
    ) {
      return Result.failure()
    }
    if (request.expiresAtMillis?.let { it <= System.currentTimeMillis() } == true) {
      clearNotification(request)
      return Result.success()
    }
    if (!HarkUrlPolicy.isSameBackendApi(request.responseUrl, request.backendOrigin)) {
      return Result.failure()
    }

    return try {
      val connection = URL(request.responseUrl).openConnection() as HttpURLConnection
      connection.requestMethod = "POST"
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { stream ->
        stream.write(request.requestBody().toString().toByteArray(Charsets.UTF_8))
      }
      val status = connection.responseCode
      connection.disconnect()
      when {
        status in 200..299 || status in setOf(400, 404, 409) -> {
          clearNotification(request)
          Result.success()
        }
        status == 408 || status == 429 || status >= 500 -> Result.retry()
        else -> Result.failure()
      }
    } catch (_: java.io.IOException) {
      Result.retry()
    }
  }

  private fun clearNotification(request: HarkResponseRequest) {
    HarkDeliveryCoordinator.coordinated {
      val store = HarkInteractionExpiryStore(applicationContext)
      val identity = HarkInteractionExpiryStore.identity(request.interactionId, request.actionDigest)
      if (store.currentIdentity(request.notificationTag) in setOf(null, identity)) {
        store.clear(request.notificationTag)
        HarkWork.cancelInteractionExpiry(applicationContext, request.notificationTag)
        HarkNotificationRenderer(applicationContext).cancel(request.notificationTag)
      }
    }
  }

  companion object {
    const val KEY_REQUEST = "request"
  }
}
