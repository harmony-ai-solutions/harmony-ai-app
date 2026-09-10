export const migration039 = `
-- RESERVED NUMBER — no-op placeholder.
--
-- Engine migration 000039 (harmony-link-private) creates device_push_tokens,
-- the local-engine FCM registration table (D-PUSH-10). It is deliberately NOT
-- mirrored here: it is pure engine/backend infrastructure. The table is not part of
-- the sync protocol on either side.
--
-- This placeholder keeps the app migration NUMBER aligned with the engine's
-- (app 000039 == engine 000039) so the 1:1 number mirror survives; the next
-- real migration on either side is 000040 on both.
`;
