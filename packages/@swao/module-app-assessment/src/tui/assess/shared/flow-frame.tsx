// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module, the frame of the Application and LZ Catalog flows
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (TUI-11, Design 126 sections 3, 4.5 and 7): the phases before the run
// of the Application and LZ Catalog flows render through ScreenLayout with
// the step bar and the licence line. While the AbortDialog of
// useFlowNavigation is open it replaces the step content, so no input of the
// step reads Enter or Esc at the same time (section 7.5).
//
// The composite pickers of tui-kit (LlmModelPicker, LzCatalogPicker,
// CommunityFrameworkPicker) draw their own key hints and guidance box; for
// them `ownGuidance` keeps blocks 1 to 4 (header, licence line, step bar,
// title) and leaves blocks 7 and 8 to the picker.

import type { ReactNode } from 'react';
import { Box } from 'ink';
import {
  HeaderView, ScreenLayout, StepBar, StepTitle, fitStepBar, useHeaderWidth,
  type GuidanceBoxProps, type HeaderViewProps, type KeyHint,
} from '@swao/tui-kit';

/** The header of a flow: subtitle, version and licence state (blocks 1 and 2). */
export type FlowHeader = Omit<HeaderViewProps, 'hideLicenseStatus'>;

export interface FlowFrameProps {
  header: FlowHeader;
  /** Step bar labels of the flow and the current step. */
  steps: readonly string[];
  current: number;
  /** Block 4: the step title (the step bar label or the sub-step name) and one purpose line. */
  title?: string;
  subtitle?: string;
  /** Block 7. Ignored with `ownGuidance`. */
  keys?: readonly KeyHint[];
  /** Block 8. Ignored with `ownGuidance`. */
  guidance?: Omit<GuidanceBoxProps, 'marginTop' | 'onOpenChange' | 'keys'>;
  /** The composite picker in the content draws its own hints and guidance box. */
  ownGuidance?: boolean;
  /** Called when the guidance box opens or closes (Esc closes the box first). */
  onGuidanceOpenChange(open: boolean): void;
  /** The AbortDialog of useFlowNavigation while it is open. */
  dialog: JSX.Element | null;
  children?: ReactNode;
}

/** #4256: the frame of the current phase, handed to the shared phases (preflight, challenge offer). */
export type FlowFrameBase = Pick<FlowFrameProps, 'header' | 'steps' | 'current' | 'onGuidanceOpenChange' | 'dialog'>;

export function FlowFrame({ header, steps, current, title, subtitle, keys = [], guidance, ownGuidance = false, onGuidanceOpenChange, dialog, children }: FlowFrameProps): JSX.Element {
  const width = useHeaderWidth();
  const content = dialog ?? children;
  if (ownGuidance) {
    const bar = steps.length > 1 ? fitStepBar([...steps], current, width) : null;
    return (
      <Box flexDirection="column" width={width}>
        <HeaderView {...header} />
        {bar && <StepBar steps={bar.labels} currentIndex={current} gap={bar.gap} bulletGap={bar.bulletGap} />}
        {title && <StepTitle title={title} subtitle={subtitle} />}
        <Box flexDirection="column" marginTop={title ? 1 : 0}>{content}</Box>
      </Box>
    );
  }
  return (
    <ScreenLayout
      header={header}
      steps={{ labels: [...steps], current }}
      title={title ? { title, subtitle } : undefined}
      keys={keys}
      guidance={{ title: title ?? '', ...guidance, onOpenChange: onGuidanceOpenChange }}
    >
      {content}
    </ScreenLayout>
  );
}
