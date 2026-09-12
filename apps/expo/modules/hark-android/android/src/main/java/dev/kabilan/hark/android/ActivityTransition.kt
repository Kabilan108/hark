package dev.kabilan.hark.android

internal data class ActivityRecord(
  val sequence: Long,
  val terminal: Boolean,
  val dismissed: Boolean,
  val expiresAtMillis: Long,
  val stateJson: String,
)

internal enum class ActivityDecision {
  RENDER,
  CANCEL,
  IGNORE,
}

internal data class ActivityTransition(
  val record: ActivityRecord,
  val decision: ActivityDecision,
)

internal object ActivityReducer {
  fun reduce(
    current: ActivityRecord?,
    sequence: Long,
    event: ActivityEvent,
    expiresAtMillis: Long,
    stateJson: String,
    nowMillis: Long,
  ): ActivityTransition {
    if (current?.terminal == true || (current != null && sequence <= current.sequence)) {
      return ActivityTransition(current ?: error("terminal record missing"), ActivityDecision.IGNORE)
    }
    val terminal = event == ActivityEvent.END || expiresAtMillis <= nowMillis
    val record = ActivityRecord(
      sequence = sequence,
      terminal = terminal,
      dismissed = current?.dismissed == true,
      expiresAtMillis = expiresAtMillis,
      stateJson = stateJson,
    )
    val decision = when {
      terminal -> ActivityDecision.CANCEL
      record.dismissed -> ActivityDecision.IGNORE
      else -> ActivityDecision.RENDER
    }
    return ActivityTransition(record, decision)
  }
}
