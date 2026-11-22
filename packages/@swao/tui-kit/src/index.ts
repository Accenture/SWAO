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
export {
  GuidanceBox, MAX_WHAT_CHARS, MAX_DETAIL_VALUE_CHARS, GUIDANCE_CLOSE_HINT, countWrappedLines, paginateDetails,
  wrapLines, explanationLineLimit, keyHintLineCount, EXPLANATION_LINES_WIDE, EXPLANATION_LINES_NARROW, EXPLANATION_WIDE_FROM, MORE_SECTION_LABEL,
} from './components/GuidanceBox.js';
export { TerminalFrame, terminalFrameHeight, terminalFrameWidth } from './components/TerminalFrame.js';
export type { TerminalFrameProps } from './components/TerminalFrame.js';
export type { GuidanceDetail, GuidanceBoxProps } from './components/GuidanceBox.js';
export { TextInput } from './components/TextInput.js';
export { SelectInput, PickerRow } from './components/SelectInput.js';
export type { SelectOption, PickerRowProps } from './components/SelectInput.js';
export { MultiSelect } from './components/MultiSelect.js';
export type { MultiSelectOption } from './components/MultiSelect.js';
export { classifyMouseInput, acquireMouseReporting, MouseReportingManager, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING } from './input/mouse.js';
export type { MouseClassification } from './input/mouse.js';
// #4379: pasted text in single-line inputs (Design 126 section 7.11).
export { sanitisePastedText, appendPastedText, hasPasteMarker } from './input/paste.js';
export type { PasteAppendResult } from './input/paste.js';
export { ProgressBar } from './components/ProgressBar.js';
export { LiveOutput } from './components/LiveOutput.js';
export { StepBar } from './components/StepBar.js';
export { PasswordInput } from './components/PasswordInput.js';
export { HeaderView, setHeaderBuildTag, headerVersionText } from './components/HeaderView.js';
export { headerRuleWidth, useHeaderWidth, fitToWidth, HEADER_MIN_WIDTH, HEADER_MAX_WIDTH, HEADER_EDGE_MARGIN } from './components/header-width.js';
export type { HeaderViewProps } from './components/HeaderView.js';
export {
  LicenseStatusLine,
  licenseStatusColor,
  formatBudget,
  formatExpiry,
} from './components/LicenseStatusLine.js';
export type { LicenseStateView, LicenseColorState, LicenseStatusColor } from './components/LicenseStatusLine.js';
export { LicenseGate, isAllowed, LICENSE_GATE_KEYS, licenseGateGuidance } from './components/LicenseGate.js';
export type { LicenseTier } from './components/LicenseGate.js';
export { RunContextPicker, assessedAppGuidance, assessedAppOptions } from './components/RunContextPicker.js';
export type { RunContextPickerProps, SelectedRunContext } from './components/RunContextPicker.js';
export { CommunityFrameworkPicker, buildFrameworkPickerOptions, expandFrameworkSelection } from './components/CommunityFrameworkPicker.js';
export type { CommunityFrameworkOption, CommunityFrameworkPickerProps } from './components/CommunityFrameworkPicker.js';
export { LzCatalogPicker, applyLzCuratedLabels, CURATED_LZ_FW_LABELS } from './components/LzCatalogPicker.js';
export type { LzPickerOption, LzCatalogPickerProps } from './components/LzCatalogPicker.js';
export { LlmModelPicker, LLM_PROVIDER_OPTIONS, formatLlmCurrentLabel } from './components/LlmModelPicker.js';
export type { LlmModelPickerProps } from './components/LlmModelPicker.js';

// Design 126 (ADR-0072): the binding TUI standard. theme.ts is the only place
// with an Ink colour name (#4258, gate G-13).
export { TOKENS, TOKEN_NAMES, STATUS_TOKENS, tone, tokenColor, inkStyleName } from './theme.js';
export type { Token, InkStyle, StatusLevel } from './theme.js';
export { ColourLegend, COLOUR_LEGEND_SAMPLES } from './components/ColourLegend.js';
export { KeyHints, KEY_HINTS, KEY_VERBS, KEY_NAME_FULL, KEY_HINT_SEPARATOR, formatKeyHint, formatKeyHints } from './components/KeyHints.js';
export type { KeyHint, KeyHintsProps, KeyName, KeyVerb } from './components/KeyHints.js';
export {
  StatusLabel, StatusRow, DetailRow, statusRowHeight, statusLabelWidth, statusLabelColumnFor, MIN_STATUS_SUMMARY_WIDTH, STATUS_MAP, STATUS_LEVELS, WRITE_CAPABLE_ACCEPTED, statusText, formatCounter,
  ROW_INDENT, STATUS_COLUMN_WIDTH, DETAIL_LABEL_WIDTH,
} from './components/StatusLabel.js';
export type { StatusEntry, StatusLabelProps, StatusRowProps, DetailRowProps } from './components/StatusLabel.js';
export { StepTitle } from './components/StepTitle.js';
export type { StepTitleProps } from './components/StepTitle.js';
export { ScreenLayout, SCREEN_BLOCKS } from './components/ScreenLayout.js';
// #4348: the shared height rule of paged lists.
export { computeListWindow, listBudget, useListBudget, useListBudgetFrame, ListBudgetScope, pickerBudgetRows, ListBudgetContext, GUIDANCE_COLLAPSED_ROWS } from './components/list-window.js';
export type { ListWindow, ListBudgetFrame, ListBudgetScopeProps } from './components/list-window.js';
// #4348: the window of a paged list, measured or before the first measurement.
export { pagedListWindow, pagedListStep, UNMEASURED_LIST_LINES } from './components/paged-list.js';
export type { ScreenLayoutProps } from './components/ScreenLayout.js';
export { fitStepBar, stepBarWidth } from './components/StepBar.js';
export type { StepBarLayout } from './components/StepBar.js';
// Design 126 wave 3a, lane F2: flow navigation, run, finish and error panels.
export { AbortDialog, ABORT_DIALOG_TEXT } from './components/AbortDialog.js';
export type { AbortDialogKind, AbortDialogProps } from './components/AbortDialog.js';
export { ConfirmPanel, CONFIRM_PANEL_KEYS, PANEL_LABEL_WIDTH, SummaryBlock, panelLabelWidth } from './components/ConfirmPanel.js';
export type { ConfirmPanelProps } from './components/ConfirmPanel.js';
export { useFlowNavigation } from './hooks/useFlowNavigation.js';
export type { FlowNavigation, FlowNavigationOptions, FlowAbortKind, FlowStepKind } from './hooks/useFlowNavigation.js';
export { useAfterFirstFrame, FIRST_FRAME_DELAY_MS, APPS_LOADING_LINE } from './hooks/useAfterFirstFrame.js';
export { FilterLine, filterLineText, withFilterHint, useActiveFilter, useFilterRegistration, FILTER_CURSOR, FILTER_KEY_HINT, DEFAULT_FILTER_GUIDANCE, FILTER_GUIDANCE_LABEL, MODEL_FILTER_GUIDANCE } from './components/list-filter.js';
export { RunPanel, StageProgress, RunOutput, RUN_PANEL_KEYS, PROGRESS_LABEL_WIDTH } from './components/RunPanel.js';
export type { RunPanelProps, StageProgressProps, RunOutputProps } from './components/RunPanel.js';
export {
  normalizeRunDashes, shortenUserPaths, runOutputLine, hangingPrefix, stagePercent, formatElapsed, formatEta, wrapWords, USER_PATH_VARIABLES,
} from './components/run-output.js';
export {
  FinishPanel, ErrorPanel, FINISH_PANEL_KEYS, ERROR_PANEL_KEYS, FINISH_MAIN_MENU, ERROR_BACK,
  scoreText, finishRows, finishMenu, recoveryMenu, causeText, errorGuidance,
} from './components/FinishPanel.js';
export type { FinishPanelProps, FinishItem, ErrorPanelProps } from './components/FinishPanel.js';

// #1680: shared cap for all LLM/framework/region pickers -- 10 rows keeps the
// list within a standard terminal window and avoids Ink highlight-skip on small
// screens. All SelectInput/MultiSelect callers should use this constant rather
// than hardcoding a visibleCount. #4249: defined in picker.ts with the other
// shared picker rules, so the components import it without a cycle.
export {
  PICKER_VISIBLE_COUNT, PICKER_RESERVED_ROWS, CURSOR_MARKER, PICKER_ROW_INDENT, withLabelColon, resolveVisibleCount,
  labelColumnWidth, rowLabelWidth, MIN_DETAIL_WIDTH, fitDetail, detailLines, matchesFilter, nextFilterQuery, optionNumber, windowEnd, scrollTopFor,
} from './components/picker.js';
export type { DetailLines } from './components/picker.js';
export { useOptionGuidance, guidanceOwnsKey, GuidancePresenceContext, useGuidancePresence, useReportGuidancePresence } from './components/guidance-entry.js';
// #4394: the one owner of the guidance box open state.
export { GuidanceOpenContext, createGuidanceOpenState, useGuidanceOpen, useGuidanceOpenOwner } from './components/guidance-open.js';
export type { GuidanceOpenState } from './components/guidance-open.js';
export type { GuidanceEntry, GuidanceSection, GuidedOption, GuidanceKey, GuidancePresenceReport } from './components/guidance-entry.js';
