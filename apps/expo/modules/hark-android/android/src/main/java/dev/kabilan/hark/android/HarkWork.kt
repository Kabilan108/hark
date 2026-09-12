package dev.kabilan.hark.android

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

internal object HarkWork {
  fun enqueueResponse(context: Context, request: HarkResponseRequest) {
    val data = Data.Builder().putString(HarkResponseWorker.KEY_REQUEST, request.toJson().toString()).build()
    val work = OneTimeWorkRequestBuilder<HarkResponseWorker>()
      .setInputData(data)
      .addTag(ALL_WORK_TAG)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      "hark-response-${digest(request.identity)}",
      ExistingWorkPolicy.KEEP,
      work,
    )
  }

  fun scheduleExpiry(context: Context, activity: HarkEnvelope.Activity) {
    val delay = (activity.expiresAtMillis - System.currentTimeMillis()).coerceAtLeast(0)
    val data = Data.Builder()
      .putString(HarkActivityExpiryWorker.KEY_BACKEND_ORIGIN, activity.backendOrigin)
      .putString(HarkActivityExpiryWorker.KEY_ACTIVITY_ID, activity.activityId)
      .putLong(HarkActivityExpiryWorker.KEY_SEQUENCE, activity.sequence)
      .build()
    val work = OneTimeWorkRequestBuilder<HarkActivityExpiryWorker>()
      .setInitialDelay(delay, TimeUnit.MILLISECONDS)
      .setInputData(data)
      .addTag(ALL_WORK_TAG)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      "hark-expiry-${digest("${activity.backendOrigin}\u0000${activity.activityId}")}",
      ExistingWorkPolicy.REPLACE,
      work,
    )
  }

  fun scheduleTerminalRemoval(context: Context, activity: HarkEnvelope.Activity, delaySeconds: Long) {
    val data = Data.Builder()
      .putString(HarkActivityRemovalWorker.KEY_BACKEND_ORIGIN, activity.backendOrigin)
      .putString(HarkActivityRemovalWorker.KEY_ACTIVITY_ID, activity.activityId)
      .putLong(HarkActivityRemovalWorker.KEY_SEQUENCE, activity.sequence)
      .build()
    val work = OneTimeWorkRequestBuilder<HarkActivityRemovalWorker>()
      .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
      .setInputData(data)
      .addTag(ALL_WORK_TAG)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      "hark-removal-${digest("${activity.backendOrigin}\u0000${activity.activityId}")}",
      ExistingWorkPolicy.REPLACE,
      work,
    )
  }

  fun scheduleInteractionExpiry(
    context: Context,
    notificationTag: String,
    interactionIdentity: String,
    expiresAtMillis: Long,
  ) {
    val delay = (expiresAtMillis - System.currentTimeMillis()).coerceAtLeast(0)
    val data = Data.Builder()
      .putString(HarkInteractionExpiryWorker.KEY_NOTIFICATION_TAG, notificationTag)
      .putString(HarkInteractionExpiryWorker.KEY_INTERACTION_IDENTITY, interactionIdentity)
      .putLong(HarkInteractionExpiryWorker.KEY_EXPIRES_AT, expiresAtMillis)
      .build()
    val work = OneTimeWorkRequestBuilder<HarkInteractionExpiryWorker>()
      .setInitialDelay(delay, TimeUnit.MILLISECONDS)
      .setInputData(data)
      .addTag(ALL_WORK_TAG)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      interactionExpiryWorkName(notificationTag),
      ExistingWorkPolicy.REPLACE,
      work,
    )
  }

  fun cancelInteractionExpiry(context: Context, notificationTag: String) {
    WorkManager.getInstance(context).cancelUniqueWork(interactionExpiryWorkName(notificationTag))
  }

  private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .take(12)
    .joinToString("") { "%02x".format(it) }

  private fun interactionExpiryWorkName(notificationTag: String): String =
    "hark-interaction-expiry-${digest(notificationTag)}"

  fun cancelAll(context: Context) {
    WorkManager.getInstance(context).cancelAllWorkByTag(ALL_WORK_TAG)
  }

  private const val ALL_WORK_TAG = "hark-android"
}
