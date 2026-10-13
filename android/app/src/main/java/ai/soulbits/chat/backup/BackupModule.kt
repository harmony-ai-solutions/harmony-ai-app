package ai.soulbits.chat.backup

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.documentfile.provider.DocumentFile
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID

/**
 * BackupModule — JS ↔ native bridge for the Android backup pieces (plan 2-6
 * step 2): the SAF folder picker, the WorkManager schedule control, the share
 * sheet, and the Dropbox/OneDrive OAuth 2 + PKCE flows.
 *
 * Legacy `ReactContextBaseJavaModule` (same pattern as EngineSidecarModule /
 * ChatBubbleModule). JS wrapper: `src/services/backup/backupNative.ts`.
 */
@ReactModule(name = BackupModule.NAME)
class BackupModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pendingFolder: Promise? = null
  private var pendingOAuth: Promise? = null
  private var pendingOAuthProvider: String? = null
  private var pendingCodeVerifier: String? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    reactContext.removeActivityEventListener(this)
    pendingFolder = null
    pendingOAuth = null
    super.invalidate()
  }

  // ── availability ──────────────────────────────────────────────────────

  @ReactMethod
  fun isAvailable(promise: Promise) = promise.resolve(true)

  // ── SAF folder picker ─────────────────────────────────────────────────

  @ReactMethod
  fun pickFolder(promise: Promise) {
    // RN 0.86: ReactContextBaseJavaModule no longer exposes currentActivity /
    // startActivityForResult (they moved to ReactApplicationContext — the same
    // pattern ChatBubbleModule uses). Access via the React context instead.
    if (reactContext.currentActivity == null) {
      promise.reject("no_activity", "No foreground activity")
      return
    }
    pendingFolder = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
      )
    }
    reactContext.startActivityForResult(intent, REQ_PICK_FOLDER, null)
  }

  // ── scheduling ────────────────────────────────────────────────────────

  @ReactMethod
  fun scheduleBackup(options: ReadableMap?, promise: Promise) {
    val cadence = options?.getString("cadence")
    val constraints = options?.getMap("constraints")
    BackupScheduler.schedule(reactContext, cadence, constraints)
    promise.resolve(true)
  }

  @ReactMethod
  fun cancelBackup(promise: Promise) {
    BackupScheduler.cancel(reactContext)
    promise.resolve(true)
  }

  @ReactMethod
  fun runBackupNow(promise: Promise) {
    BackupScheduler.runNow(reactContext)
    promise.resolve(true)
  }

  // ── share sheet export ────────────────────────────────────────────────

  @ReactMethod
  fun shareFile(options: ReadableMap?, promise: Promise) {
    val path = options?.getString("filePath")
    if (path.isNullOrEmpty()) {
      promise.reject("bad_args", "filePath is required")
      return
    }
    val mime = options.getString("mimeType") ?: "application/octet-stream"
    val uri: Uri = androidx.core.content.FileProvider.getUriForFile(
      reactContext, "${reactContext.packageName}.backupfiles", java.io.File(path),
    )
    val intent = Intent(Intent.ACTION_SEND).apply {
      type = mime
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val chooser = Intent.createChooser(intent, "Export backup")
    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(chooser)
    promise.resolve(true)
  }

  // ── OAuth 2 + PKCE ────────────────────────────────────────────────────

  @ReactMethod
  fun startOAuth(options: ReadableMap?, promise: Promise) {
    val provider = options?.getString("provider")
    val cfg = OAUTH_PROVIDERS[provider]
    if (cfg == null) {
      promise.reject("unsupported_provider", "Unsupported provider: $provider")
      return
    }
    val verifier = generateCodeVerifier()
    val challenge = codeChallenge(verifier)
    pendingOAuth = promise
    pendingOAuthProvider = provider
    pendingCodeVerifier = verifier

    val authorizeUrl = Uri.parse(cfg.authorizeEndpoint).buildUpon()
      .appendQueryParameter("client_id", cfg.clientId)
      .appendQueryParameter("response_type", "code")
      .appendQueryParameter("redirect_uri", REDIRECT_URI)
      .appendQueryParameter("code_challenge", challenge)
      .appendQueryParameter("code_challenge_method", "S256")
      .appendQueryParameter("token_access_type", "offline")
      .build()

    CustomTabsIntent.Builder().build().launchUrl(reactContext, authorizeUrl)
  }

  @ReactMethod
  fun clearOAuth(options: ReadableMap?, promise: Promise) {
    // Token custody lives in the JS keychain; nothing native to clear today.
    promise.resolve(true)
  }

  /**
   * Called by the app's deep-link handler when the OAuth redirect lands
   * (`soulbits://oauth/<provider>?code=...`). Exchanges the code for a token
   * and resolves the pending [startOAuth] promise.
   */
  fun handleOAuthRedirect(uri: Uri) {
    val promise = pendingOAuth ?: return
    val provider = pendingOAuthProvider
    val verifier = pendingCodeVerifier
    pendingOAuth = null
    pendingOAuthProvider = null
    pendingCodeVerifier = null

    val cfg = OAUTH_PROVIDERS[provider]
    val code = uri.getQueryParameter("code")
    if (cfg == null || code.isNullOrEmpty() || verifier.isNullOrEmpty()) {
      promise.reject("oauth_failed", "Missing code or PKCE verifier")
      return
    }
    try {
      val token = OAuthPkce.exchangeCodeForToken(cfg, code, verifier, REDIRECT_URI)
      val result = Arguments.createMap()
      result.putString("accessToken", token)
      promise.resolve(result)
    } catch (t: Throwable) {
      promise.reject("oauth_exchange_failed", t)
    }
  }

  // ── ActivityResult ────────────────────────────────────────────────────

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQ_PICK_FOLDER) return
    val promise = pendingFolder ?: return
    pendingFolder = null
    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      promise.resolve(null)
      return
    }
    val treeUri = data.data!!
    // Persist read/write access across reboots.
    val flags = data.flags and
      (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      reactContext.contentResolver.takePersistableUriPermission(treeUri, flags)
    } catch (_: SecurityException) {
      // Non-persistable provider; the URI still works for this session.
    }
    val label = DocumentFile.fromTreeUri(reactContext, treeUri)?.name ?: treeUri.toString()
    val result = Arguments.createMap()
    result.putString("uri", treeUri.toString())
    result.putString("label", label)
    promise.resolve(result)
  }

  override fun onNewIntent(intent: Intent) { /* handled by the deep-link layer */ }

  // ── helpers ───────────────────────────────────────────────────────────

  private fun generateCodeVerifier(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return android.util.Base64.encodeToString(
      bytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
    )
  }

  private fun codeChallenge(verifier: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
    return android.util.Base64.encodeToString(
      digest, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
    )
  }

  data class OAuthProvider(val authorizeEndpoint: String, val tokenEndpoint: String, val clientId: String)

  companion object {
    const val NAME = "SoulbitsBackup"
    private const val REQ_PICK_FOLDER = 0x8A21

    /** The app's OAuth redirect (registered as a deep link in the manifest). */
    const val REDIRECT_URI = "soulbits://oauth/callback"

    // Client ids are injected per build flavour (see scripts/oauth-secrets.cjs).
    private val OAUTH_PROVIDERS: Map<String?, OAuthProvider> = mapOf(
      "dropbox" to OAuthProvider(
        authorizeEndpoint = "https://www.dropbox.com/oauth2/authorize",
        tokenEndpoint = "https://api.dropboxapi.com/oauth2/token",
        clientId = "",
      ),
      "onedrive" to OAuthProvider(
        authorizeEndpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenEndpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientId = "",
      ),
    )
  }
}
