/**
 * Repository seam (task 3-2, reduced in task 3-4).
 *
 * After the TS SQLite stack deletion, this module is a PURE re-export of the
 * management-API-backed repository adapters (`src/services/engine/repositories/*`).
 * Screens, services and components keep importing repository functions from
 * THIS module — the flag dispatch and the SQLite fallback are gone; the engine's
 * local management API is the single data layer.
 */

export * from '../../services/engine/repositories/entities';
export * from '../../services/engine/repositories/characters';
export * from '../../services/engine/repositories/userEntities';
export * from '../../services/engine/repositories/interactions';
export * from '../../services/engine/repositories/conversation_messages';
export * from '../../services/engine/repositories/emoji_actions';
export * from '../../services/engine/repositories/emotion_state';
export * from '../../services/engine/repositories/memories';
export * from '../../services/engine/repositories/chatConversationSettings';
export * from '../../services/engine/repositories/modules';
export * from '../../services/engine/repositories/providers';
