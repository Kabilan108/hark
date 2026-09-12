package dev.kabilan.hark.android

/** Serializes persisted delivery state with notification side effects in this app process. */
internal object HarkDeliveryCoordinator {
  private val lock = Any()

  fun <T> coordinated(block: () -> T): T = synchronized(lock, block)
}
