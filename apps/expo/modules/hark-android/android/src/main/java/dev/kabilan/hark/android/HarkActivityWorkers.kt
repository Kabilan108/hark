package dev.kabilan.hark.android

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

internal class HarkActivityExpiryWorker(
  appContext: Context,
  workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {
  override fun doWork(): Result {
    val origin = inputData.getString(KEY_BACKEND_ORIGIN) ?: return Result.failure()
    val activityId = inputData.getString(KEY_ACTIVITY_ID) ?: return Result.failure()
    val sequence = inputData.getLong(KEY_SEQUENCE, -1)
    if (sequence < 0) return Result.failure()
    HarkDeliveryCoordinator.coordinated {
      if (HarkActivityStore(applicationContext).expireIfCurrent(origin, activityId, sequence)) {
        HarkNotificationRenderer(applicationContext).cancelActivity(origin, activityId)
      }
    }
    return Result.success()
  }

  companion object {
    const val KEY_BACKEND_ORIGIN = "backendOrigin"
    const val KEY_ACTIVITY_ID = "activityId"
    const val KEY_SEQUENCE = "sequence"
  }
}

internal class HarkActivityRemovalWorker(
  appContext: Context,
  workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {
  override fun doWork(): Result {
    val origin = inputData.getString(KEY_BACKEND_ORIGIN) ?: return Result.failure()
    val activityId = inputData.getString(KEY_ACTIVITY_ID) ?: return Result.failure()
    val sequence = inputData.getLong(KEY_SEQUENCE, -1)
    HarkDeliveryCoordinator.coordinated {
      val current = HarkPreferences(applicationContext).activityRecord(origin, activityId)
      if (current?.terminal == true && current.sequence == sequence) {
        HarkNotificationRenderer(applicationContext).cancelActivity(origin, activityId)
      }
    }
    return Result.success()
  }

  companion object {
    const val KEY_BACKEND_ORIGIN = "backendOrigin"
    const val KEY_ACTIVITY_ID = "activityId"
    const val KEY_SEQUENCE = "sequence"
  }
}

internal class HarkInteractionExpiryWorker(
  appContext: Context,
  workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {
  override fun doWork(): Result {
    val notificationTag = inputData.getString(KEY_NOTIFICATION_TAG) ?: return Result.failure()
    val expectedIdentity = inputData.getString(KEY_INTERACTION_IDENTITY) ?: return Result.failure()
    val expiresAtMillis = inputData.getLong(KEY_EXPIRES_AT, -1)
    if (expiresAtMillis < 0) return Result.failure()

    return HarkDeliveryCoordinator.coordinated {
      val store = HarkInteractionExpiryStore(applicationContext)
      when (
        InteractionExpiryReducer.decide(
          currentIdentity = store.currentIdentity(notificationTag),
          expectedIdentity = expectedIdentity,
          expiresAtMillis = expiresAtMillis,
          nowMillis = System.currentTimeMillis(),
        )
      ) {
        InteractionExpiryDecision.WAIT -> Result.retry()
        InteractionExpiryDecision.IGNORE -> Result.success()
        InteractionExpiryDecision.CANCEL -> {
          if (store.clearIfCurrent(notificationTag, expectedIdentity)) {
            HarkNotificationRenderer(applicationContext).cancel(notificationTag)
          }
          Result.success()
        }
      }
    }
  }

  companion object {
    const val KEY_NOTIFICATION_TAG = "notificationTag"
    const val KEY_INTERACTION_IDENTITY = "interactionIdentity"
    const val KEY_EXPIRES_AT = "expiresAt"
  }
}
