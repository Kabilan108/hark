package dev.kabilan.hark.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class InteractionExpiryTest {
  @Test
  fun `current interaction is canceled at expiry`() {
    assertEquals(
      InteractionExpiryDecision.CANCEL,
      InteractionExpiryReducer.decide("current", "current", 1_000, 1_000),
    )
  }

  @Test
  fun `current interaction waits before expiry`() {
    assertEquals(
      InteractionExpiryDecision.WAIT,
      InteractionExpiryReducer.decide("current", "current", 1_001, 1_000),
    )
  }

  @Test
  fun `replacement is not canceled by stale expiry work`() {
    assertEquals(
      InteractionExpiryDecision.IGNORE,
      InteractionExpiryReducer.decide("replacement", "old", 1_000, 1_000),
    )
  }

  @Test
  fun `identity changes with interaction or action contract`() {
    val first = HarkInteractionExpiryStore.identity("int-1", "a".repeat(64))

    assertNotEquals(first, HarkInteractionExpiryStore.identity("int-2", "a".repeat(64)))
    assertNotEquals(first, HarkInteractionExpiryStore.identity("int-1", "b".repeat(64)))
  }
}
