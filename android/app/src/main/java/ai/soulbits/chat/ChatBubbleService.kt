package ai.soulbits.chat

import android.app.Activity
import android.app.Application
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
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.runtime.ReactSurfaceImpl
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
  private var bubbleBadgeView: android.widget.TextView? = null

  // Drag bookkeeping
  private var initialX = 0
  private var initialY = 0
  private var initialTouchX = 0f
  private var initialTouchY = 0f
  private var isDragging = false
  private var longPressTriggered = false
  private var lastVelocityX = 0f
  private var lastVelocityY = 0f
  private var lastMoveTime = 0L
  private val longPressHandler = android.os.Handler(android.os.Looper.getMainLooper())

  // Snap/dismiss animations
  private var snapAnimator: android.animation.ValueAnimator? = null
  private var dismissAnimator: android.animation.ValueAnimator? = null

  private var conversationJson: String? = null

  /** Total unread messages shown on the badge. */
  @Volatile
  private var unreadCount = 0

  // ── Floating chat window (ReactSurface overlay) ──
  private var chatSurface: ReactSurface? = null
  private var chatWindowParams: WindowManager.LayoutParams? = null
  private var chatView: View? = null

  private var lifecycleCallback: Application.ActivityLifecycleCallbacks? = null

  /**
   * Whether we force-resumed the ReactHost for the floating chat window.
   *
   * The overlay is a React surface on the SAME ReactHost as the main activity.
   * When the user opens the bubble while the app is in the background, the
   * host is paused and RN has frozen the JS timer/Choreographer infrastructure
   * — the window would render but never finish loading. While the window is
   * open we keep the host resumed (see openFloatingChat); closeFloatingChat()
   * restores the real (paused) lifecycle state.
   */
  private var hostResumedForOverlay = false

  /** Last activity that was resumed — used to force-resume the host. */
  private var lastResumedActivity: Activity? = null

  /**
   * Whether the app's main activity is currently in the foreground. Tracks the
   * real lifecycle so restoreHostPauseAfterOverlay() only pauses the host when
   * the activity genuinely ISN'T foreground (e.g. the user returned to the app
   * and then closed the overlay — the host must stay resumed in that case).
   */
  private var isAppActivityResumed = false

  override fun onCreate() {
    super.onCreate()
    // Close the floating chat window when the app's activity goes to
    // background.
    //
    // Why: the floating window is a React surface on the SAME ReactHost as the
    // main activity. When the activity pauses, RN pauses the host — freezing
    // the overlay on whatever frame it shows (a stuck spinner) and the JS
    // bridge stops delivering events reliably. This native callback closes the
    // window the moment the activity pauses. The bubble (a plain native overlay
    // view) stays visible.
    lifecycleCallback = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityPaused(activity: Activity) {
        isAppActivityResumed = false
        closeFloatingChat()
      }
      override fun onActivityResumed(activity: Activity) {
        isAppActivityResumed = true
        lastResumedActivity = activity
        // The framework resumes the host when the activity comes back to the
        // foreground — from that point the host lifecycle is owned by the
        // activity again, so our overlay-driven resume flag must be cleared
        // (closeFloatingChat must NOT pause a foregrounded host).
        hostResumedForOverlay = false
      }
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivityCreated(activity: Activity, savedInstanceState: android.os.Bundle?) {}
      override fun onActivityDestroyed(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: android.os.Bundle) {}
    }
    try {
      (application as Application).registerActivityLifecycleCallbacks(lifecycleCallback)
    } catch (_: Exception) {
      // ignore — callback registration is best-effort
    }
    // If the service starts while the app is already foreground, no
    // onActivityResumed callback fires for the current resume — read the host's
    // lifecycle state directly so isAppActivityResumed reflects reality.
    try {
      val app = application as? ReactApplication
      val host = app?.reactHost
      if (host != null && host.lifecycleState == LifecycleState.RESUMED) {
        isAppActivityResumed = true
      }
    } catch (_: Exception) {
      // ignore
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_SET_UNREAD -> {
        val count = intent.getIntExtra(EXTRA_UNREAD_COUNT, 0)
        setUnreadCount(count)
        return START_NOT_STICKY
      }
      ACTION_CLOSE_WINDOW -> {
        // Close only the floating chat window — the bubble stays.
        closeFloatingChat()
        return START_NOT_STICKY
      }
      else -> {
        conversationJson = intent?.getStringExtra(EXTRA_CONVERSATION)
        startForegroundCompat()
        showBubble()
        return START_STICKY
      }
    }
  }

  override fun onDestroy() {
    lifecycleCallback?.let {
      try {
        (application as Application).unregisterActivityLifecycleCallbacks(it)
      } catch (_: Exception) {
        // ignore
      }
    }
    lifecycleCallback = null
    removeBubble()
    closeFloatingChat()
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
    val ringView = view.findViewById<ImageView>(R.id.chat_bubble_ring)

    val avatarBitmap = decodeAvatar(conversationJson)
    if (avatarBitmap != null) {
      avatarView.setImageBitmap(avatarBitmap)
    } else {
      avatarView.setImageResource(android.R.drawable.ic_dialog_email)
    }

    // ── Round the bubble ──
    // Clip the avatar to a perfect circle (center-crop square → circle).
    val bubbleSize = dp(64)
    val radius = bubbleSize / 2f
    val roundRect = android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.OVAL
      setColor(0xFF000000.toInt())
    }
    avatarView.setClipToOutline(true)
    avatarView.outlineProvider =
      object : android.view.ViewOutlineProvider() {
        override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
          outline.setOval(0, 0, bubbleSize, bubbleSize)
        }
      }
    avatarView.setBackground(roundRect)

    // Ripple ring — soft accent-colored ring around the circle.
    val ringDrawable = android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.OVAL
      setColor(0x00000000)
      setStroke(dp(3), 0x66FFFFFF.toInt())
    }
    ringView.setBackground(ringDrawable)
    ringView.visibility = android.view.View.VISIBLE

    // Unread badge — small red count dot at the top-right of the bubble.
    val badge = android.widget.TextView(this).apply {
      text = if (unreadCount > 99) "99+" else unreadCount.toString()
      textSize = 11f
      setTextColor(0xFFFFFFFF.toInt())
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      gravity = android.view.Gravity.CENTER
      background = android.graphics.drawable.GradientDrawable().apply {
        shape = android.graphics.drawable.GradientDrawable.OVAL
        setColor(0xFFE53935.toInt())
      }
      // position at top-right corner of the bubble
      setPadding(dp(5), dp(2), dp(5), dp(2))
    }
    // Layout the badge over the top-right of the avatar. We add it to the
    // FrameLayout (chat_bubble) at ~top-right.
    val badgeLp = android.widget.FrameLayout.LayoutParams(
      android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
      android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
    ).apply {
      gravity = android.view.Gravity.TOP or android.view.Gravity.END
      marginStart = 0
      topMargin = dp(2)
      marginEnd = dp(2)
    }
    badge.visibility = if (unreadCount > 0) android.view.View.VISIBLE else android.view.View.GONE
    (view as android.widget.FrameLayout).addView(badge, badgeLp)
    bubbleBadgeView = badge

    val wmType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val params = WindowManager.LayoutParams(
      bubbleSize,
      bubbleSize,
      wmType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = metrics.heightPixels / 3
    }

    // ── Drag + tap handling ──
    // Physics: the bubble follows the finger; on release it either
    //   1. flings toward the nearest edge and snaps to it, or
    //   2. if released over the bottom dismiss area, animates away (hide).
    view.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          lastVelocityX = 0f
          lastVelocityY = 0f
          lastMoveTime = 0L
          isDragging = false
          longPressTriggered = false
          snapAnimator?.cancel()
          dismissAnimator?.cancel()
          // Long-press (hold) arms the removal mode: reveal the ✕ target at the
          // bottom and give a haptic cue. Only then can the bubble be dragged
          // onto the ✕ to permanently remove it.
          longPressHandler.postDelayed(
            {
              longPressTriggered = true
              showDismissArea()
              view.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            },
            LONG_PRESS_MS,
          )
          true
        }

        MotionEvent.ACTION_MOVE -> {
          // Dragging must be able to start both BEFORE and AFTER the long-press
          // fires. If the user holds still (long-press triggers) and THEN starts
          // dragging, isDragging is set here. If the user drags immediately
          // (before the long-press), the long-press callback is cancelled.
          if (!isDragging) {
            val dx = event.rawX - initialTouchX
            val dy = event.rawY - initialTouchY
            if (Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP) {
              isDragging = true
              if (!longPressTriggered) {
                longPressHandler.removeCallbacksAndMessages(null)
              }
            }
          }
          if (isDragging) {
            params.x = initialX + (event.rawX - initialTouchX).toInt()
            params.y = initialY + (event.rawY - initialTouchY).toInt()
            // Clamp within screen bounds (leave a small margin). Y is allowed to
            // reach the very bottom so the bubble can be dropped on the ✕ target.
            params.x = params.x.coerceIn(-bubbleSize / 2, metrics.widthPixels - bubbleSize / 2)
            params.y = params.y.coerceIn(0, metrics.heightPixels - bubbleSize / 2)
            try {
              windowManager.updateViewLayout(view, params)
            } catch (_: IllegalArgumentException) {
              // ignore
            }
            // Velocity tracking (px/ms).
            val now = System.currentTimeMillis()
            if (lastMoveTime != 0L) {
              val dt = (now - lastMoveTime).coerceAtLeast(1L)
              lastVelocityX = (event.rawX - initialTouchX) / dt
              lastVelocityY = (event.rawY - initialTouchY) / dt
              // Keep velocity normalized to px/s for the fling decision.
              lastVelocityX *= 1000f
              lastVelocityY *= 1000f
            }
            lastMoveTime = now
            // Highlight the ✕ while the bubble hovers over it (hold-to-remove mode).
            if (longPressTriggered) {
              updateDismissHighlight(params.x + bubbleSize / 2f, params.y + bubbleSize / 2f)
            }
          }
          true
        }

        MotionEvent.ACTION_UP -> {
          longPressHandler.removeCallbacksAndMessages(null)
          hideDismissArea()
          if (isDragging || longPressTriggered) {
            // Hold + drop on the ✕ target → permanently remove the bubble.
            if (longPressTriggered && isOverDismissTarget(params.x, params.y)) {
              animateDismiss()
            } else {
              snapToEdge()
            }
          } else {
            // Plain tap → toggle the floating chat window (open/close).
            if (chatView != null) {
              closeFloatingChat()
            } else {
              openFloatingChat()
            }
          }
          isDragging = false
          longPressTriggered = false
          true
        }

        MotionEvent.ACTION_CANCEL -> {
          longPressHandler.removeCallbacksAndMessages(null)
          hideDismissArea()
          if (isDragging) snapToEdge()
          isDragging = false
          longPressTriggered = false
          true
        }

        else -> true
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
    snapAnimator?.cancel()
    dismissAnimator?.cancel()
    hideDismissArea()
    bubbleView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: IllegalArgumentException) {
        // Already removed — safe to ignore.
      }
    }
    bubbleView = null
    bubbleParams = null
    bubbleBadgeView = null
  }

  // ---------------------------------------------------------------------------
  // Bubble physics: edge snap, dismiss, dismiss-area overlay
  // ---------------------------------------------------------------------------

  /** Smoothly move the bubble to the nearest horizontal edge, keeping its Y. */
  private fun snapToEdge() {
    val view = bubbleView ?: return
    val p = bubbleParams ?: return
    val bubbleSize = p.width
    val targetX =
      if (p.x + bubbleSize / 2f < metrics.widthPixels / 2f) {
        -bubbleSize / 6 // small overhang left (messenger-style)
      } else {
        metrics.widthPixels - bubbleSize + bubbleSize / 6
      }
    val startX = p.x
    val startY = p.y
    val targetY = p.y.coerceIn(0, metrics.heightPixels - bubbleSize)
    snapAnimator?.cancel()
    snapAnimator =
      android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 220
        interpolator = android.view.animation.DecelerateInterpolator()
        addUpdateListener { a ->
          val t = a.animatedFraction
          val nx = startX + ((targetX - startX) * t).toInt()
          val ny = startY + ((targetY - startY) * t).toInt()
          p.x = nx
          p.y = ny
          try {
            windowManager.updateViewLayout(view, p)
          } catch (_: Exception) {
            // ignore
          }
        }
      }
    snapAnimator?.start()
  }

  /** Animate the bubble shrinking away (dismissed). */
  private fun animateDismiss() {
    val view = bubbleView ?: return
    val p = bubbleParams ?: return
    val startX = p.x
    val startY = p.y
    val startW = p.width
    val startH = p.height
    dismissAnimator?.cancel()
    dismissAnimator =
      android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 200
        interpolator = android.view.animation.AccelerateInterpolator()
        addUpdateListener { a ->
          val t = a.animatedFraction
          val curW = (startW * (1f - t)).toInt().coerceAtLeast(1)
          val curH = (startH * (1f - t)).toInt().coerceAtLeast(1)
          val curX = startX + ((startW - curW) / 2).toInt()
          val curY = startY + ((startH - curH) / 2).toInt()
          val np = WindowManager.LayoutParams(
            curW,
            curH,
            p.type,
            p.flags,
            PixelFormat.TRANSLUCENT,
          ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = curX
            y = curY
          }
          try {
            windowManager.updateViewLayout(view, np)
          } catch (_: Exception) {
            // ignore
          }
        }
        addListener(object : android.animation.Animator.AnimatorListener {
          override fun onAnimationStart(animation: android.animation.Animator) {}
          override fun onAnimationCancel(animation: android.animation.Animator) {}
          override fun onAnimationRepeat(animation: android.animation.Animator) {}
          override fun onAnimationEnd(animation: android.animation.Animator) {
            // Bubble dismissed — stop the foreground service (kills overlay).
            stopSelf()
          }
        })
      }
    dismissAnimator?.start()
  }

  /** A translucent bottom strip with an ✕ glyph shown while dragging. */
  private var dismissAreaView: View? = null
  private var dismissAreaParams: WindowManager.LayoutParams? = null
  /** Screen bounds of the ✕ dismiss target (bottom-center). */
  private var dismissAreaBounds: android.graphics.Rect? = null
  /** Whether the ✕ target is currently highlighted (bubble hovering over it). */
  private var dismissHighlighted = false

  private fun showDismissArea() {
    if (dismissAreaView != null) return
    val wmType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val strip = android.widget.FrameLayout(this).apply {
      val bg = android.graphics.drawable.GradientDrawable().apply {
        shape = android.graphics.drawable.GradientDrawable.RECTANGLE
        setColor(0x33FF5252.toInt()) // subtle translucent red
        setCornerRadius(dp(20).toFloat())
      }
      background = bg
      val xIcon = android.widget.TextView(context).apply {
        text = "✕"
        textSize = 28f
        setTextColor(0xFFFFFFFF.toInt())
        gravity = android.view.Gravity.CENTER
      }
      addView(
        xIcon,
        android.widget.FrameLayout.LayoutParams(
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
          android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
        ),
      )
    }
    val params = WindowManager.LayoutParams(
      dp(80),
      dp(80),
      wmType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      x = 0
      y = -dp(16)
    }
    try {
      windowManager.addView(strip, params)
      dismissAreaView = strip
      dismissAreaParams = params
      dismissHighlighted = false
      // Screen bounds of the ✕ target (bottom-center, offset by params.y).
      val w = params.width
      val h = params.height
      val left = (metrics.widthPixels - w) / 2
      val bottom = metrics.heightPixels - params.y
      dismissAreaBounds = android.graphics.Rect(left, bottom - h, left + w, bottom)
    } catch (_: Exception) {
      // ignore
    }
  }

  private fun hideDismissArea() {
    dismissAreaView?.let {
      try {
        windowManager.removeView(it)
      } catch (_: Exception) {
        // ignore
      }
    }
    dismissAreaView = null
    dismissAreaParams = null
    dismissAreaBounds = null
    dismissHighlighted = false
  }

  /** Whether the bubble's center is inside the ✕ dismiss target. */
  private fun isOverDismissTarget(bubbleX: Int, bubbleY: Int): Boolean {
    val bounds = dismissAreaBounds ?: return false
    val size = bubbleView?.width ?: dp(64)
    return bounds.contains(bubbleX + size / 2, bubbleY + size / 2)
  }

  /** Visually emphasize the ✕ target while the bubble hovers over it. */
  private fun updateDismissHighlight(centerX: Float, centerY: Float) {
    val bounds = dismissAreaBounds ?: return
    val strip = dismissAreaView ?: return
    val over = bounds.contains(centerX.toInt(), centerY.toInt())
    if (over == dismissHighlighted) return
    dismissHighlighted = over
    if (over) {
      strip.animate().scaleX(1.2f).scaleY(1.2f).setDuration(120).start()
    } else {
      strip.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
    }
  }

  /** Update the unread badge (called from JS via ChatBubbleModule). */
  fun setUnreadCount(count: Int) {
    unreadCount = count.coerceAtLeast(0)
    val badge = bubbleBadgeView
    if (badge == null) return
    badge.text = if (unreadCount > 99) "99+" else unreadCount.toString()
    badge.visibility = if (unreadCount > 0) android.view.View.VISIBLE else android.view.View.GONE
  }

  // ---------------------------------------------------------------------------
  // Tap → floating chat window
  // ---------------------------------------------------------------------------

  /**
   * A compact, phone-width chat panel floating neatly in the CENTER of the
   * screen. The bubble stays visible and draggable above it. The panel is
   * ~88% screen width but only ~66% height, with a fade + scale-in animation
   * (NO window resize animation — mutating WindowManager size during mount
   * leaves the Fabric surface blank in RN 0.86 new architecture).
   *
   * Sizing keeps the panel comfortably INSIDE the screen: it never reaches
   * the top or bottom edge, and is centered both horizontally and vertically.
   */
  private fun floatingChatSize(): Pair<Int, Int> {
    val w = (metrics.widthPixels * 0.82f).toInt().coerceAtMost(dp(400))
    // Keep ~17% screen height as margin above and below the panel.
    val h = (metrics.heightPixels * 0.56f).toInt()
      .coerceAtMost(metrics.heightPixels - dp(160))
    return w to h
  }

  /** Open the conversation as a floating window over other apps. */
  private fun openFloatingChat() {
    if (chatView != null) {
      // Already open — bring it back in front.
      try {
        windowManager.updateViewLayout(chatView, chatWindowParams)
      } catch (_: Exception) {
        // ignore
      }
      return
    }
    // Don't open a window without a conversation payload.
    if (conversationJson.isNullOrEmpty()) {
      openInApp()
      return
    }

    val app = application as? ReactApplication ?: return
    val host = app.reactHost ?: return

    // Build the React surface that renders the FloatingChat JS component.
    val initialProps = android.os.Bundle().apply {
      putString("conversation", conversationJson)
    }
    val surface = try {
      host.createSurface(this, FLOATING_CHAT_MODULE, initialProps)
    } catch (_: Exception) {
      // Surface creation failed (host not ready) — fall back to the full app.
      openInApp()
      return
    }
    chatSurface = surface

    // Host the surface's ReactSurfaceView in an overlay window.
    val wmType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val (finalW, finalH) = floatingChatSize()

    // The floating chat window must be FOCUSABLE so its TextInput can receive
    // the keyboard (the bubble itself stays NOT_FOCUSABLE). FLAG_ALT_FOCUSABLE_IM
    // must NOT be set: combined with a focusable window it disables the soft
    // input mode, so the keyboard never appears and the input bar is unusable.
    val params = WindowManager.LayoutParams(
      finalW,
      finalH,
      wmType,
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_INSET_DECOR,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      // CENTERED on the phone (both axes) with comfortable margins so the
      // panel never touches the top/bottom/left/right edges.
      x = ((metrics.widthPixels - finalW) / 2).coerceAtLeast(dp(8))
      y = ((metrics.heightPixels - finalH) / 2).coerceAtLeast(dp(12))
      // Resize the panel above the keyboard so the input bar stays visible
      // while typing.
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    }
    chatWindowParams = params

    // The ReactSurfaceView renders the JS chat UI.
    val surfaceView = surface.view
    if (surfaceView == null) {
      closeFloatingChat()
      openInApp()
      return
    }
    // Rounded corners on the window.
    val cornerRadius = dp(20).toFloat()
    val windowBg = android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.RECTANGLE
      setColor(0xE61A1A2E.toInt())
      setCornerRadius(cornerRadius)
    }
    surfaceView.setBackground(windowBg)
    surfaceView.clipToOutline = true
    surfaceView.outlineProvider =
      object : android.view.ViewOutlineProvider() {
        override fun getOutline(view: android.view.View, outline: android.graphics.Outline) {
          outline.setRoundRect(0, 0, view.width, view.height, cornerRadius)
        }
      }

    try {
      // The floating window is a React surface on the SAME ReactHost as the
      // main activity. When the app is in the background the host is paused,
      // and RN's JavaTimerManager has frozen the JS timer/Choreographer
      // pipeline (it resumes only on ReactContext.onHostResume()). If we
      // start the surface while paused, the window shows its initial frame
      // (the loading spinner) but every async step — DB-ready poll, theme
      // load, message queries — never completes because timers never fire.
      //
      // Force-resume the host for as long as the window is open so the
      // overlay can actually load. closeFloatingChat() restores the real
      // (paused) lifecycle state.
      forceResumeHostForOverlay()

      // Start the surface BEFORE adding the view so the first frame is ready
      // the moment the window appears (avoids a blank first paint).
      surface.start()
      windowManager.addView(surfaceView, params)
      chatView = surfaceView

      // The chat window is added AFTER the bubble, so it would cover it.
      // Windows added later sit above earlier windows — re-adding the bubble
      // (with a fresh LayoutParams) brings it back ON TOP of the chat panel so
      // it stays visible and tappable to close the window.
      bringBubbleToFront()

      // When the chat window gains focus (e.g. tapping the input bar), the
      // system moves the focused window above not-focusable ones — re-assert
      // the bubble on top so it never hides behind the window while typing.
      surfaceView.setOnFocusChangeListener { _, hasFocus ->
        if (hasFocus) bringBubbleToFront()
      }

      // Fade + scale-in (visual only, no layout change). The panel appears
      // centered, so the pivot stays at the panel center.
      surfaceView.alpha = 0f
      surfaceView.scaleX = 0.92f
      surfaceView.scaleY = 0.92f
      surfaceView.pivotX = finalW / 2f
      surfaceView.pivotY = finalH / 2f
      surfaceView.postDelayed(
        {
          surfaceView.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(220)
            .setInterpolator(android.view.animation.DecelerateInterpolator())
            .start()
        },
        50,
      )
    } catch (_: Exception) {
      closeFloatingChat()
      openInApp()
    }
  }

  /**
   * Re-assert the bubble ABOVE the floating chat window. Windows added later
   * sit above earlier ones, so removing + re-adding the bubble (with a fresh
   * LayoutParams) brings it back on top. Called when the chat window opens and
   * again whenever it regains focus (tapping the input would otherwise put the
   * focused window above the not-focusable bubble).
   */
  private fun bringBubbleToFront() {
    val bubble = bubbleView ?: return
    val bp = bubbleParams ?: return
    try {
      windowManager.removeView(bubble)
    } catch (_: Exception) {
      // ignore
    }
    val fresh = WindowManager.LayoutParams(
      bp.width,
      bp.height,
      bp.type,
      bp.flags,
      bp.format,
    ).apply {
      gravity = bp.gravity
      x = bp.x
      y = bp.y
    }
    try {
      windowManager.addView(bubble, fresh)
    } catch (_: Exception) {
      // ignore
    }
  }

  /** Tear down the floating chat window (surface). The bubble stays. */
  private fun closeFloatingChat() {
    try {
      chatView?.let { windowManager.removeView(it) }
    } catch (_: Exception) {
      // ignore
    }
    chatView = null
    chatWindowParams = null
    chatSurface?.stop()
    chatSurface = null
    restoreHostPauseAfterOverlay()
  }

  /**
   * Force the ReactHost back into the RESUMED state while the floating chat
   * window is open.
   *
   * This is safe to call unconditionally: ReactHostImpl.onHostResume() only
   * transitions when the host is NOT already resumed, and asserting a resume
   * from a paused host is a normal RN lifecycle operation. The resume makes
   * the Choreographer/JS-timer pipeline run so the overlay can load.
   */
  private fun forceResumeHostForOverlay() {
    try {
      val app = application as? ReactApplication ?: return
      val host = app.reactHost ?: return
      if (host.lifecycleState != LifecycleState.RESUMED) {
        logHost("Forcing ReactHost resume for floating chat overlay (state=$host.lifecycleState)")
        // 1-arg resume — unlike the 2-arg version it does NOT overwrite the
        // activity's DefaultHardwareBackBtnHandler (which ReactActivity owns).
        host.onHostResume(lastResumedActivity)
        hostResumedForOverlay = true
      }
    } catch (_: Exception) {
      // ignore — best-effort
    }
  }

  /**
   * If we force-resumed the host for the overlay, restore the real lifecycle
   * state: the host was genuinely paused (app backgrounded) before the window
   * opened, so move it back to BEFORE_RESUME. When the app is actually
   * foreground, the host is already RESUMED (owned by the resumed activity)
   * and we never force-resumed it, so this is a no-op.
   *
   * Edge case: the user opens the overlay while backgrounded (we force-resume),
   * then returns to the app and closes the overlay. The activity resume
   * callback clears hostResumedForOverlay, so this skips the pause — otherwise
   * we would freeze the foregrounded app.
   */
  private fun restoreHostPauseAfterOverlay() {
    if (!hostResumedForOverlay) return
    hostResumedForOverlay = false
    // If the app's activity is in the foreground, the host lifecycle is owned
    // by the framework — never pause it from here.
    if (isAppActivityResumed) return
    try {
      val app = application as? ReactApplication ?: return
      val host = app.reactHost ?: return
      logHost("Restoring ReactHost pause after floating chat overlay closed")
      // No-arg onHostPause() is safe: it moves the host back to
      // BEFORE_RESUME using its stored currentActivity — no activity-identity
      // assertion (the 2-arg version would assert the passed activity === the
      // host's currentActivity and could crash if we restore with a stale/null
      // reference).
      host.onHostPause()
    } catch (_: Exception) {
      // ignore — best-effort
    }
  }

  private fun logHost(message: String) {
    android.util.Log.i("ChatBubbleService", message)
  }

  /** Launch the conversation in the full app (previous behavior). */
  private fun openInApp() {
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
      val host = app.reactHost ?: return
      val reactContext = host.currentReactContext ?: return
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
      val dataUrl = json.optString("avatar").takeIf { it.isNotEmpty() } ?: return null
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
    const val ACTION_SET_UNREAD = "ai.soulbits.chat.action.SET_UNREAD"
    const val ACTION_CLOSE_WINDOW = "ai.soulbits.chat.action.CLOSE_WINDOW"
    const val EXTRA_CONVERSATION = "conversation_json"
    const val EXTRA_UNREAD_COUNT = "unread_count"
    /** JS module registered for the floating chat surface. */
    const val FLOATING_CHAT_MODULE = "FloatingChat"
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
