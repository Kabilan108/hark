package dev.kabilan.hark.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

internal class HarkNotificationRenderer(private val context: Context) {
  private val manager = NotificationManagerCompat.from(context)

  init {
    createChannels()
  }

  fun showNotification(notification: HarkEnvelope.Notification) {
    if (!canPostNotifications()) return
    val tag = eventTag(notification.backendOrigin, notification.eventId)
    val builder = NotificationCompat.Builder(context, EVENTS_CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(notification.title)
      .setContentText(notification.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(notification.body))
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setOnlyAlertOnce(false)
      .setAutoCancel(true)
      .setContentIntent(contentIntent(notification.deepLink, notification.eventId, tag))

    val interaction = validInteraction(notification.interaction)
    interaction?.let {
      addInteractionActions(builder, interaction, tag)
    }
    manager.notify(tag, NOTIFICATION_ID, builder.build())
    updateInteractionExpiry(tag, interaction)
  }

  fun showActivity(activity: HarkEnvelope.Activity, terminal: Boolean = false) {
    if (!canPostNotifications()) return
    val state = activity.state
    val title = state.optString("title").trim().ifEmpty { "Hark activity" }.take(160)
    val status = state.optString("status").trim().ifEmpty {
      if (terminal) "Finished" else "In progress"
    }.take(80)
    val detail = state.optString("detail").trim().take(240)
    val progress = state.optDouble("progress", Double.NaN)
      .takeUnless(Double::isNaN)
      ?.coerceIn(0.0, 1.0)
    val tag = activityTag(activity.backendOrigin, activity.activityId)
    val preferences = HarkPreferences(context)
    val canPromote = !terminal &&
      preferences.watchedActivitiesEnabled &&
      manager.canPostPromotedNotifications()
    val builder = NotificationCompat.Builder(context, ACTIVITIES_CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setContentText(if (detail.isEmpty()) status else "$status · $detail")
      .setSubText(status)
      .setOngoing(!terminal)
      .setAutoCancel(terminal)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setRequestPromotedOngoing(canPromote)
      .setShortCriticalText(status.take(7))
      .setProgress(100, ((progress ?: 0.0) * 100).roundToInt(), progress == null)
      .setContentIntent(contentIntent(activity.deepLink, null, tag))

    if (state.optString("privacyMode") == "private") {
      builder
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(
          NotificationCompat.Builder(context, ACTIVITIES_CHANNEL_ID)
            .setSmallIcon(smallIcon())
            .setContentTitle("Hark activity")
            .setContentText(if (terminal) "Activity finished" else "Activity in progress")
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setOngoing(!terminal)
            .build(),
        )
    }

    val accent = parseColor(state.optString("accentColor"))
    if (accent != null) builder.color = accent
    val progressStyle = NotificationCompat.ProgressStyle()
      .setProgressIndeterminate(progress == null)
    if (progress != null) progressStyle.setProgress((progress * 100).roundToInt())
    builder.setStyle(progressStyle)

    if (!terminal) {
      builder
        .setDeleteIntent(unpinIntent(activity, tag, deleteIntent = true))
        .addAction(0, "Unpin", unpinIntent(activity, tag, deleteIntent = false))
      validInteraction(HarkProtocol.activityInteraction(activity))?.let { interaction ->
        addInteractionActions(builder, interaction, tag)
      }
    }
    manager.notify(tag, ACTIVITY_NOTIFICATION_ID, builder.build())
  }

  fun cancelEvent(backendOrigin: String, eventId: String) {
    val tag = eventTag(backendOrigin, eventId)
    HarkInteractionExpiryStore(context).clear(tag)
    HarkWork.cancelInteractionExpiry(context, tag)
    cancel(tag)
  }

  fun cancelActivity(backendOrigin: String, activityId: String) {
    cancel(activityTag(backendOrigin, activityId))
  }

  fun cancel(tag: String) {
    manager.cancel(tag, if (tag.startsWith("hark:activity:")) ACTIVITY_NOTIFICATION_ID else NOTIFICATION_ID)
  }

  private fun validInteraction(interaction: Interaction?): Interaction? {
    if (interaction == null) return null
    if (interaction.expiresAtMillis?.let { it <= System.currentTimeMillis() } == true) return null
    val deviceId = interaction.deviceId ?: HarkPreferences(context).deviceId
    return interaction.takeIf { !deviceId.isNullOrBlank() }
  }

  private fun updateInteractionExpiry(notificationTag: String, interaction: Interaction?) {
    val store = HarkInteractionExpiryStore(context)
    if (interaction == null) {
      store.clear(notificationTag)
      HarkWork.cancelInteractionExpiry(context, notificationTag)
      return
    }
    val identity = store.track(notificationTag, interaction)
    val expiresAtMillis = interaction.expiresAtMillis
    if (expiresAtMillis == null) {
      HarkWork.cancelInteractionExpiry(context, notificationTag)
    } else {
      HarkWork.scheduleInteractionExpiry(context, notificationTag, identity, expiresAtMillis)
    }
  }

  private fun addInteractionActions(
    builder: NotificationCompat.Builder,
    interaction: Interaction,
    notificationTag: String,
  ) {
    when (interaction.kind) {
      "approval" -> {
        builder.addAction(responseAction(interaction, "approve", label(interaction, "approve", "Approve"), notificationTag))
        builder.addAction(responseAction(interaction, "deny", label(interaction, "deny", "Deny"), notificationTag))
      }
      "yes_no" -> {
        builder.addAction(responseAction(interaction, "yes", label(interaction, "yes", "Yes"), notificationTag))
        builder.addAction(responseAction(interaction, "no", label(interaction, "no", "No"), notificationTag))
      }
      "reply" -> {
        val pendingIntent = responsePendingIntent(interaction, "reply", notificationTag, mutable = true)
        val remoteInput = RemoteInput.Builder(HarkActionReceiver.REMOTE_INPUT_KEY)
          .setLabel("Reply")
          .build()
        builder.addAction(
          NotificationCompat.Action.Builder(0, label(interaction, "reply", "Reply"), pendingIntent)
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(false)
            .build(),
        )
      }
    }
  }

  private fun responseAction(
    interaction: Interaction,
    action: String,
    title: String,
    notificationTag: String,
  ): NotificationCompat.Action = NotificationCompat.Action.Builder(
    0,
    title,
    responsePendingIntent(interaction, action, notificationTag, mutable = false),
  ).build()

  private fun responsePendingIntent(
    interaction: Interaction,
    action: String,
    notificationTag: String,
    mutable: Boolean,
  ): PendingIntent {
    val intent = Intent(context, HarkActionReceiver::class.java)
      .setAction(HarkActionReceiver.ACTION_RESPONSE)
      .putExtra(HarkActionReceiver.EXTRA_BACKEND_ORIGIN, originFromResponseUrl(interaction.responseUrl))
      .putExtra(HarkActionReceiver.EXTRA_INTERACTION_ID, interaction.id)
      .putExtra(HarkActionReceiver.EXTRA_INTERACTION_KIND, interaction.kind)
      .putExtra(HarkActionReceiver.EXTRA_ACTION, action)
      .putExtra(HarkActionReceiver.EXTRA_ACTION_DIGEST, interaction.actionDigest)
      .putExtra(HarkActionReceiver.EXTRA_RESPONSE_TOKEN, interaction.responseToken)
      .putExtra(HarkActionReceiver.EXTRA_RESPONSE_URL, interaction.responseUrl)
      .putExtra(HarkActionReceiver.EXTRA_EXPIRES_AT, interaction.expiresAtMillis ?: -1L)
      .putExtra(HarkActionReceiver.EXTRA_DEVICE_ID, interaction.deviceId)
      .putExtra(HarkActionReceiver.EXTRA_DELIVERY_ID, interaction.deliveryId)
      .putExtra(HarkActionReceiver.EXTRA_CREDENTIAL, interaction.credential)
      .putExtra(HarkActionReceiver.EXTRA_NOTIFICATION_TAG, notificationTag)
    val mutability = if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getBroadcast(
      context,
      "$notificationTag\u0000$action".hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or mutability,
    )
  }

  private fun unpinIntent(
    activity: HarkEnvelope.Activity,
    notificationTag: String,
    deleteIntent: Boolean,
  ): PendingIntent {
    val intent = Intent(context, HarkActionReceiver::class.java)
      .setAction(HarkActionReceiver.ACTION_UNPIN)
      .putExtra(HarkActionReceiver.EXTRA_BACKEND_ORIGIN, activity.backendOrigin)
      .putExtra(HarkActionReceiver.EXTRA_ACTIVITY_ID, activity.activityId)
      .putExtra(HarkActionReceiver.EXTRA_NOTIFICATION_TAG, notificationTag)
    return PendingIntent.getBroadcast(
      context,
      "$notificationTag\u0000unpin\u0000$deleteIntent".hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun contentIntent(deepLink: String?, eventId: String?, tag: String): PendingIntent {
    val uri = HarkUrlPolicy.safeTapUri(deepLink) ?: eventId?.let {
      val composite = if (it.startsWith("anot")) "notification:$it" else "event:$it"
      Uri.parse("hark-android://notification/${Uri.encode(composite)}")
    } ?: Uri.parse("hark-android://home")
    val intent = Intent(Intent.ACTION_VIEW, uri)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      .apply {
        if (uri.scheme == "hark-android") setPackage(context.packageName)
      }
    return PendingIntent.getActivity(
      context,
      tag.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun originFromResponseUrl(responseUrl: String): String {
    val uri = Uri.parse(responseUrl)
    return uri.buildUpon().path(null).query(null).fragment(null).build().toString().trimEnd('/')
  }

  private fun label(interaction: Interaction, action: String, fallback: String): String =
    interaction.actions.firstOrNull { it.id == action }?.title ?: fallback

  private fun canPostNotifications(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED

  private fun smallIcon(): Int = R.drawable.ic_hark_notification

  private fun parseColor(value: String): Int? = runCatching {
    if (COLOR.matches(value)) Color.parseColor(value) else null
  }.getOrNull()

  private fun createChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val notificationManager = context.getSystemService(NotificationManager::class.java)
    notificationManager.createNotificationChannel(
      NotificationChannel(EVENTS_CHANNEL_ID, "Hark events", NotificationManager.IMPORTANCE_DEFAULT),
    )
    notificationManager.createNotificationChannel(
      NotificationChannel(
        ACTIVITIES_CHANNEL_ID,
        "Hark live updates",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Progress for tasks you choose to watch"
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  companion object {
    const val EVENTS_CHANNEL_ID = "hark-events"
    const val ACTIVITIES_CHANNEL_ID = "hark-live-updates"
    private const val NOTIFICATION_ID = 1001
    private const val ACTIVITY_NOTIFICATION_ID = 1002
    private val COLOR = Regex("^#[0-9A-Fa-f]{6}$")

    fun eventTag(backendOrigin: String, eventId: String): String =
      "hark:event:${HarkPreferences.activityKey(backendOrigin, eventId).removePrefix("activity.")}"

    fun activityTag(backendOrigin: String, activityId: String): String =
      "hark:activity:${HarkPreferences.activityKey(backendOrigin, activityId).removePrefix("activity.")}"
  }
}
