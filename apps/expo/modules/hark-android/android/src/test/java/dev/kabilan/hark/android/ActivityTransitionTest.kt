package dev.kabilan.hark.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityTransitionTest {
  @Test
  fun `older and duplicate sequences do not replace state`() {
    val current = ActivityRecord(4, terminal = false, dismissed = false, 10_000, "new")

    val duplicate = ActivityReducer.reduce(current, 4, ActivityEvent.UPDATE, 20_000, "duplicate", 1)
    val older = ActivityReducer.reduce(current, 3, ActivityEvent.UPDATE, 20_000, "old", 1)

    assertEquals(ActivityDecision.IGNORE, duplicate.decision)
    assertEquals("new", duplicate.record.stateJson)
    assertEquals(ActivityDecision.IGNORE, older.decision)
    assertEquals("new", older.record.stateJson)
  }

  @Test
  fun `end is terminal and cannot be resurrected`() {
    val ended = ActivityReducer.reduce(null, 8, ActivityEvent.END, 20_000, "ended", 1)
    val late = ActivityReducer.reduce(ended.record, 9, ActivityEvent.UPDATE, 30_000, "late", 1)

    assertTrue(ended.record.terminal)
    assertEquals(ActivityDecision.CANCEL, ended.decision)
    assertEquals(ActivityDecision.IGNORE, late.decision)
    assertEquals("ended", late.record.stateJson)
  }

  @Test
  fun `dismissed activity advances sequence without reposting`() {
    val dismissed = ActivityRecord(2, terminal = false, dismissed = true, 10_000, "before")

    val update = ActivityReducer.reduce(dismissed, 3, ActivityEvent.UPDATE, 20_000, "after", 1)

    assertEquals(ActivityDecision.IGNORE, update.decision)
    assertEquals(3, update.record.sequence)
    assertEquals("after", update.record.stateJson)
    assertTrue(update.record.dismissed)
  }

  @Test
  fun `expired update becomes terminal`() {
    val update = ActivityReducer.reduce(null, 1, ActivityEvent.START, 100, "state", 101)

    assertTrue(update.record.terminal)
    assertEquals(ActivityDecision.CANCEL, update.decision)
  }
}
