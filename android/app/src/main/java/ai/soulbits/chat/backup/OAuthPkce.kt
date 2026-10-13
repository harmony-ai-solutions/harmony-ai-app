package ai.soulbits.chat.backup

import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * OAuthPkce — the token-endpoint leg of the Dropbox/OneDrive OAuth 2 + PKCE
 * flow (plan 2-6 step 2). The authorize leg runs in a Custom Tab
 * ([BackupModule.startOAuth]); the redirect is captured by the app's deep-link
 * handler and exchanged here.
 */
object OAuthPkce {
  /** Exchange an authorization code (with its PKCE verifier) for an access token. */
  fun exchangeCodeForToken(
    provider: BackupModule.OAuthProvider,
    code: String,
    codeVerifier: String,
    redirectUri: String,
  ): String {
    val params = buildString {
      append("grant_type=authorization_code")
      append("&code=").append(enc(code))
      append("&client_id=").append(enc(provider.clientId))
      append("&redirect_uri=").append(enc(redirectUri))
      append("&code_verifier=").append(enc(codeVerifier))
    }
    val conn = (URL(provider.tokenEndpoint).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      doOutput = true
      setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
      connectTimeout = 30_000
      readTimeout = 30_000
    }
    conn.outputStream.use { it.write(params.toByteArray(Charsets.UTF_8)) }

    val status = conn.responseCode
    val body = (if (status in 200..299) conn.inputStream else conn.errorStream)
      ?.bufferedReader()?.use(BufferedReader::readText) ?: ""
    if (status !in 200..299) {
      throw RuntimeException("OAuth token exchange failed ($status): $body")
    }
    return extractJsonString(body, "access_token")
      ?: throw RuntimeException("OAuth response carried no access_token")
  }

  private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

  /** Minimal JSON string-field extractor (avoids a JSON dependency here). */
  private fun extractJsonString(json: String, field: String): String? {
    val needle = "\"$field\""
    val i = json.indexOf(needle)
    if (i < 0) return null
    val rest = json.substring(i + needle.length)
    val colon = rest.indexOf(':')
    if (colon < 0) return null
    val after = rest.substring(colon + 1).trimStart()
    if (!after.startsWith("\"")) return null
    val end = after.indexOf('"', 1)
    if (end < 0) return null
    return after.substring(1, end)
  }
}
