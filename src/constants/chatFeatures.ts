/**
 * Chat feature gates.
 *
 * Message reply-to (quote replies): the full pipeline is restored and live —
 * DB column (`conversation_messages.reply_to_message_id`), send payload field,
 * bubble reply headers, reply preview bar and action-sheet entry — but the UI
 * entry points stay GATED OFF until the feature is officially re-enabled
 * (originally retired as O4 during the senju-rebase follow-up Phase 1; the
 * keep-but-hidden consensus restored the plumbing in this branch).
 *
 * Flip to `true` to re-enable the reply UI (action-sheet "Reply" row +
 * input-bar reply preview). No other change is required.
 */
export const MESSAGE_REPLY_ENABLED = false;
