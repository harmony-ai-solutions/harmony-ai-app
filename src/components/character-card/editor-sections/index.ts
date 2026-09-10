/**
 * Editor sections — the reusable V3/RP profile-editor suite (Phase 8, Track C).
 *
 * Each section is a self-contained, theme-aware component with
 * props-in / onChange-out props and no screen coupling. The parent screen owns
 * the editor state + side-effect handlers; sections only render and forward.
 */

export {
  editorStateToProfileFields,
  profileToEditorState,
  validateLifecycleConfig,
} from './editorState';
export type { EditorProfileFields, EditorProfileSource, EditorState } from './editorState';

export { computeImageDeltas } from './imageReconcile';
export type {
  DesiredEditorImage,
  ImageCreateDelta,
  ImageReconcileDelta,
  ImageUpdateDelta,
} from './imageReconcile';

export { GreetingEditorSection } from './GreetingEditorSection';
export type { GreetingEditorSectionProps } from './GreetingEditorSection';

export { AlternateGreetingsSection } from './AlternateGreetingsSection';
export type { AlternateGreetingsSectionProps } from './AlternateGreetingsSection';

export { LorebookSection } from './LorebookSection';
export type { LorebookSectionProps } from './LorebookSection';

export { TagsSection } from './TagsSection';
export type { TagsSectionProps } from './TagsSection';

export { LifecycleSection } from './LifecycleSection';
export type { LifecycleSectionProps } from './LifecycleSection';

export { AttributionSection } from './AttributionSection';
export type { AttributionSectionProps } from './AttributionSection';

export { ExportSection } from './ExportSection';
export type { ExportSectionProps } from './ExportSection';

export {
  buildImportDetectionSummary,
  ImportReviewSheet,
} from './ImportReviewSheet';
export type {
  ImportDetectionSummary,
  ImportProvenanceSummary,
  ImportReviewSheetProps,
} from './ImportReviewSheet';