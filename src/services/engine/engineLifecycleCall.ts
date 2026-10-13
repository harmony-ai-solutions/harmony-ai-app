/**
 * engineLifecycleCall — shared types + pure helpers for the 4-1 facade's
 * `lifecycle.batch` / `lifecycle.maintenance` RPCs (consumed by 4-3's iOS wake
 * and overnight handlers).
 *
 * The facade's method table (engine `docs/Embed-Facade.md`) is the source of
 * truth for these shapes; the router (`embed/router.go`) marshals the DTOs
 * below. Time fields (`now`, `deadline`) are RFC3339 strings; an empty
 * `deadline` means "no deadline" and `maxBeats <= 0` means "unlimited" (the
 * engine's own convention — see the 0-4 batch notes).
 */

/** The facade RPC method names. */
export const LIFECYCLE_BATCH_METHOD = 'lifecycle.batch';
export const LIFECYCLE_MAINTENANCE_METHOD = 'lifecycle.maintenance';

/** The 0-4 default priority policy (`lifecycle.PriorityMostOverdue`). */
export const BATCH_PRIORITY_MOST_OVERDUE = 'most_overdue';

/** The executed catch-up plan attached to a completed entity (wire shape). */
export interface CatchUpPlanDto {
  elapsedSeconds: number;
  gapKind: string;
  beatsToFire: number;
  missedBeats: number;
  foldBeats: number;
  dreamDue: boolean;
  compactDue: boolean;
  outreachDue: boolean;
  seed: number;
}

/** One completed entity in a batch result. */
export interface EntityOutcomeDto {
  entityId: string;
  plan: CatchUpPlanDto;
  /** Present when the entity's catch-up errored (never aborts the batch). */
  error?: string;
}

/** The `lifecycle.batch` / `lifecycle.fireCatchUp` result. */
export interface BatchResultDto {
  completed: EntityOutcomeDto[];
  truncated: string[];
  degraded: string[];
  /**
   * Set (plan 7-8) when the whole pass was skipped because this engine is not
   * the cognition authority (`"not_authoritative"`). NOT an error — the arrays
   * above are empty and the caller records a skipped pass.
   */
  skippedReason: string | null;
}

/** One entity's overnight maintenance outcome. */
export interface MaintenanceOutcomeDto {
  entityId: string;
  ops: number;
  tokens: number;
  error?: string;
}

/** The `lifecycle.maintenance` result. */
export interface MaintenanceResultDto {
  compacted: MaintenanceOutcomeDto[];
  skipped: string[];
  degraded: string[];
  truncated: string[];
  failed: MaintenanceOutcomeDto[];
  /**
   * Set (plan 7-8) when the whole sweep was skipped because this engine is not
   * the cognition authority (`"not_authoritative"`). NOT an error.
   */
  skippedReason: string | null;
}

/** The `lifecycle.batch` request payload. */
export interface BatchRequestPayload {
  now?: string;
  deadline?: string;
  maxBeats?: number;
  priority?: string;
  degraded?: boolean;
  modelName?: string;
  contextWindowSize?: number;
}

/** The `lifecycle.maintenance` request payload. */
export interface MaintenanceRequestPayload {
  now?: string;
  deadline?: string;
  degraded?: boolean;
}

/** RFC3339 (UTC, second precision) from epoch ms — the engine's wire format. */
export function toRfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Coerce an unknown value into the batch-result shape (defensive). */
export function parseBatchResult(json: string): BatchResultDto {
  const raw = safeParse(json);
  return {
    completed: Array.isArray(raw?.completed)
      ? (raw.completed as EntityOutcomeDto[]).filter(o => o && typeof o.entityId === 'string')
      : [],
    truncated: stringArray(raw?.truncated),
    degraded: stringArray(raw?.degraded),
    skippedReason: optionalString(raw?.skipped_reason),
  };
}

/** Coerce an unknown value into the maintenance-result shape (defensive). */
export function parseMaintenanceResult(json: string): MaintenanceResultDto {
  const raw = safeParse(json);
  return {
    compacted: outcomeArray(raw?.compacted),
    skipped: stringArray(raw?.skipped),
    degraded: stringArray(raw?.degraded),
    truncated: stringArray(raw?.truncated),
    failed: outcomeArray(raw?.failed),
    skippedReason: optionalString(raw?.skipped_reason),
  };
}

/** Entity ids whose executed plan flagged an outreach due. */
export function outreachDueEntityIds(result: BatchResultDto): string[] {
  return result.completed
    .filter(o => o.plan?.outreachDue === true)
    .map(o => o.entityId);
}

function safeParse(json: string): any {
  if (!json) return null;
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function outcomeArray(value: unknown): MaintenanceOutcomeDto[] {
  if (!Array.isArray(value)) return [];
  return (value as any[]).filter(
    o => o && typeof o.entityId === 'string',
  ) as MaintenanceOutcomeDto[];
}
