// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * @swao/tui-kit -- shared Ink presentational components (ADR-0048).
 *
 * Leaf package: react + ink only, no @swao runtime dependency. The host CLI/TUI
 * and the guest modules both consume it; it depends on nothing in the workspace.
 * Components are pure + prop-driven (no internal swao imports) and carry explicit
 * JSX.Element return types so prop contextual typing survives the package
 * boundary (the cross-package TS7006 trap noted in ADR-0048).
 */
export { GuidanceBox } from './components/GuidanceBox.js';
export type { GuidanceDetail, GuidanceBoxProps } from './components/GuidanceBox.js';
export { TextInput } from './components/TextInput.js';
export { SelectInput } from './components/SelectInput.js';
export type { SelectOption } from './components/SelectInput.js';
export { MultiSelect } from './components/MultiSelect.js';
export type { MultiSelectOption } from './components/MultiSelect.js';
export { classifyMouseInput, acquireMouseReporting, MouseReportingManager, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING } from './input/mouse.js';
export type { MouseClassification } from './input/mouse.js';
export { ProgressBar } from './components/ProgressBar.js';
export { LiveOutput } from './components/LiveOutput.js';
export { StepBar } from './components/StepBar.js';
export { PasswordInput } from './components/PasswordInput.js';
export { HeaderView } from './components/HeaderView.js';
export type { HeaderViewProps } from './components/HeaderView.js';
export {
  LicenseStatusLine,
  licenseStatusColor,
  formatBudget,
  formatExpiry,
} from './components/LicenseStatusLine.js';
export type { LicenseStateView, LicenseColorState, LicenseStatusColor } from './components/LicenseStatusLine.js';
export { LicenseGate, isAllowed } from './components/LicenseGate.js';
export type { LicenseTier } from './components/LicenseGate.js';
export { RunContextPicker } from './components/RunContextPicker.js';
export type { RunContextPickerProps, SelectedRunContext } from './components/RunContextPicker.js';
export { CommunityFrameworkPicker, buildFrameworkPickerOptions, expandFrameworkSelection } from './components/CommunityFrameworkPicker.js';
export type { CommunityFrameworkOption, CommunityFrameworkPickerProps } from './components/CommunityFrameworkPicker.js';
export { LzCatalogPicker, applyLzCuratedLabels, CURATED_LZ_FW_LABELS } from './components/LzCatalogPicker.js';
export type { LzPickerOption, LzCatalogPickerProps } from './components/LzCatalogPicker.js';
export { LlmModelPicker, LLM_PROVIDER_OPTIONS, formatLlmCurrentLabel } from './components/LlmModelPicker.js';
export type { LlmModelPickerProps } from './components/LlmModelPicker.js';

// #1680: shared cap for all LLM/framework/region pickers -- 10 rows keeps the
// list within a standard terminal window and avoids Ink highlight-skip on small
// screens. All SelectInput/MultiSelect callers should use this constant rather
// than hardcoding a visibleCount.
export const PICKER_VISIBLE_COUNT = 10;
