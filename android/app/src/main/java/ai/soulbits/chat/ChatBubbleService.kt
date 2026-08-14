package ai.soulbits.chat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

/**
 * ChatBubbleService — a draggable floating bubble ("display over other apps")
 * showing the AI chat's avatar. Tapping the bubble brings the app to the front
 * and opens the conversation via a pending-conversation handoff to JS.
 *
 * Design notes:
 *  - Uses TYPE_APPLICATION_OVERLAY (Android 8+) / TYPE_PHONE (legacy), which
 *    requires the SYSTEM_ALERT_WINDOW permission.
 *  - Runs as a foreground service so the bubble survives app backgrounding.
 *  - Drag is implemented by mutating the WindowManager LayoutParams on
 *    ACTION_MOVE (the standard floating-widget pattern).
 *  - On tap: launches MainActivity with ACTION_MAIN / FLAG_ACTIVITY_NEW_TASK,
 *    stores the conversation params in a static holder, then emits a
 *    `ChatBubble.open` JS event (DeviceEventEmitter) so the app can navigate
 *    even if it was fully backgrounded.
 */
class ChatBubbleService : Service() {

  private lateinit var windowManager: WindowManager
  private var bubbleView: View? = null
  private var bubbleParams: WindowManager.LayoutParams? = null

  // Drag bookkeeping
  private var initialX = 0
  private var initialY = 0
  private var initialTouchX = 0f
  private var initialTouchY = 0f
  private var isDragging = false
  private var longPressTriggered = false
  private val longPressHandler = android.os.Handler(android.os.Looper.getMainLooper())

  private var conversationJson: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    conversationJson = intent?.getStringExtra(EXTRA_CONVERSATION)
    startForegroundCompat()
    showBubble()
    return START_STICKY
  }

  override fun onDestroy() {
    removeBubble()
    super.onDestroy()
  }

  // ---------------------------------------------------------------------------
  // Foreground notification
  // ---------------------------------------------------------------------------

  private fun startForegroundCompat() {
    val channelId = "harmony_chat_bubble"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        channelId,
        "Chat Bubble",
        NotificationManager.IMPORTANCE_MIN,
      ).apply {
        description = "Floating AI chat bubble"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val openIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      action = Intent.ACTION_MAIN
      putExtra(EXTRA_CONVERSATION, conversationJson)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = Notification.Builder(this, channelId)
      .setContentTitle("Harmony AI Chat")
      .setContentText("Tap the bubble to chat")
      .setSmallIcon(android.R.drawable.ic_dialog_email)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .build()

    startForeground(NOTIFICATION_ID, notification)
  }

  // ---------------------------------------------------------------------------
  // Bubble overlay
  // ---------------------------------------------------------------------------

  private fun showBubble() {
    if (bubbleView != null) return

    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val inflater = getSystemService(Context.LAYOUT_INFLATER_SERVICE) as LayoutInflater
    val view = inflater.inflate(R.layout.chat_bubble, null)
    val avatarView = view.findViewById<ImageView>(R.id.chat_bubble_avatar)

    val avatarBitmap = decodeAvatar(conversationJson)
    if (avatarBitmap != null) {
      avatarView.setImageBitmap(avatarBitmap)
    } else {
      avatarView.setImageResource(android.R.drawable.ic_dialog_email)
    }

    val wmType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val params = WindowManager.LayoutParams(
      dp(60),
      dp(60),
      wmType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = metrics.heightPixels / 3
    }

    // ── Drag + tap handling ──
    view.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          isDragging = false
          longPressTriggered = false
          longPressHandler.postDelayed(
            { longPressTriggered = true },
            LONG_PRESS_MS,
          )
          true
        }

        MotionEvent.ACTION_MOVE -> {
          if (!longPressTriggered) {
            val dx = event.rawX - initialTouchX
            val dy = event.rawY - initialTouchY
            if (Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP) {
              isDragging = true
              longPressHandler.removeCallbacksAndMessages(null)
            }
          }
          if (isDragging) {
            params.x = initialX + (event.rawX - initialTouchX).toInt()
            params.y = initialY + (event.rawY - initialTouchY).toInt()
            try {
              windowManager.updateViewLayout(view, params)
            } catch (_: IllegalArgumentException) {
              // LayoutParams drift after service teardown — safe to ignore.
            }
          }
          true
        }

        MotionEvent.ACTION_UP -> {
          longPressHandler.removeCallbacksAndMessages(null)
          if (!isDragging) {
            openConversation()
          }
          isDragging = false
          true
        }
      }
    }

    try {
      windowManager.addView(view, params)
      bubbleView = view
      bubbleParams = params
    } catch (e: Exception) {
      // Missing SYSTEM_ALERT_WINDOW permission or overlay already present.
      stopSelf()
    }
  }

  private fun removeBubble() {
    longPressHandler.removeCallbacksAndMessages(null)
    bubbleView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: IllegalArgumentException) {
        // Already removed — safe to ignore.
      }
    }
    bubbleView = null
    bubbleParams = null
  }

  // ---------------------------------------------------------------------------
  // Tap → open conversation
  // ---------------------------------------------------------------------------

  private fun openConversation() {
    pendingConversation = conversationJson

    // Bring the app to the foreground.
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      action = Intent.ACTION_MAIN
      putExtra(EXTRA_CONVERSATION, conversationJson)
    }
    startActivity(launchIntent)

    // If JS is attached, notify immediately so the open screen navigates.
    emitOpenEvent()
  }

  private fun emitOpenEvent() {
    try {
      val app = application as ReactApplication
      val reactContext = app.reactHost.currentReactContext ?: return
      val payload: WritableMap = Arguments.createMap()
      payload.putString("conversation", conversationJson)
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("ChatBubble.open", payload)
    } catch (_: Exception) {
      // JS not attached — the AppShell resume-handler reads pendingConversation.
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private fun decodeAvatar(conversationJson: String?): Bitmap? {
    if (conversationJson == null) return null
    return try {
      val json = org.json.JSONObject(conversationJson)
      val dataUrl = json.optString("avatar", null) ?: return null
      val comma = dataUrl.indexOf(',')
      val b64 = if (comma >= 0) dataUrl.substring(comma + 1) else dataUrl
      val bytes = Base64.decode(b64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Exception) {
      null
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private val metrics: DisplayMetrics
    get() = resources.displayMetrics

  companion object {
    const val ACTION_SHOW = "ai.soulbits.chat.action.SHOW_BUBBLE"
    const val ACTION_HIDE = "ai.soulbits.chat.action.HIDE_BUBBLE"
    const val EXTRA_CONVERSATION = "conversation_json"
    private const val NOTIFICATION_ID = 4201
    private const val LONG_PRESS_MS = 500L
    private const val TOUCH_SLOP = 8f

    /** Handoff slot for the bubble tap when JS is not attached at tap time. */
    @Volatile
    var pendingConversation: String? = null
      private set

    fun consumePendingConversation(): String? {
      val value = pendingConversation
      pendingConversation = null
      return value
    }
  }
}
