package dev.kabilan.hark.android

import android.net.Uri

internal object HarkUrlPolicy {
  fun normalizeHttpsOrigin(raw: String): String? {
    val uri = Uri.parse(raw)
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) return null
    return uri.buildUpon().path(null).query(null).fragment(null).build().toString().trimEnd('/')
  }

  fun isSameBackendApi(url: String, backendOrigin: String): Boolean {
    val target = Uri.parse(url)
    val backend = Uri.parse(backendOrigin)
    return target.scheme == "https" &&
      target.scheme == backend.scheme &&
      target.authority == backend.authority &&
      target.path?.startsWith("/api/") == true &&
      target.userInfo == null &&
      target.fragment == null
  }

  fun safeTapUri(value: String?): Uri? {
    if (value.isNullOrBlank()) return null
    val uri = Uri.parse(value)
    return uri.takeIf { it.scheme in setOf("https", "http", "hark-android") && it.userInfo == null }
  }
}
