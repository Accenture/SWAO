<!--
  S  W  A  O
  Sovereign Workload Assessment and Onboarding
  Design document 098 -- TUI screen type-split and LlmAssessmentScreen decomposition
  Apache-2.0
-->

# Design 098 -- TUI Screen Type-Split and LlmAssessmentScreen Decomposition

**Status:** Accepted -- sprint-130 implementation  
**Authors:** SWAO Development Team  
**Sprint:** 130  
**Related issues:** #2368, #2369, #2370, #2371, #2372, #2373, #2374, #2375, #2376, #2377  
**Related ADRs:** ADR-0004 (TypeScript strict), ADR-0012 (WSP schema), ADR-0032 (branch model)

---

## 1. Problem statement

`swao/packages/swao/src/tui/screens/LlmAssessmentScreen.tsx` is 1,167 lines and contains 13 stages, 19 state variables, 3 refs, 11 GuidanceBox instances, and 7 inline helper functions (`LlmAssessmentScreen.tsx:60-1167`). The monolithic structure creates three concrete problems:

1. **Reviewer comprehension cost.** A single stage fix (e.g. #2400, #2381) requires navigating ~1,000 unrelated lines to understand context.
2. **Duplicate logic across screens.** The LLM connectivity ping (`classifyPingFailure`, `createProviderFromConnector`) is repeated across SetupWizard.tsx and any future LZ assessment screen. Three separate in-file copies of "ping a provider and categorise the result" were identified during sprint-129 UAT (monitor report #2388).
3. **Test surface.** The 13-stage monolith has no unit tests for individual stage behaviour. Extraction into typed sub-units makes pure logic testable without mounting the full screen.

This design document agrees the interfaces before any code moves (per sprint-130 issue #2368 acceptance criteria).

---

## 2. Scope

This document covers:

- Stage grouping and boundary definition for LlmAssessmentScreen
- Prop interface contracts for each extracted unit
- The `useLlmPing` hook contract (extracted to `@swao/tui-kit`)
- Directory layout after extraction
- SetupWizard step extraction (same sprint, parallel track)
- Out of scope: WSP schema changes, provider contract tests, App.tsx routing beyond the assess subtree

---

## 3. Stage taxonomy

The 13 stages of `LlmAssessmentScreen` (defined at `LlmAssessmentScreen.tsx:60-73`) fall into two natural groups with a clear handoff boundary at `review-config`:

### Group A -- Leg-building (pre-run configuration)

Stages: `loading`, `picking-app`, `no-apps`, `no-legs`, `build-legs`, `pick-model`, `pick-model-custom`, `health-check`, `review-config`

User journey: select an application -> pick connectors and models -> verify connectivity -> review configuration before committing to a run.

State produced at end of group A: `selectedApp`, `resolvedLegs`, `llmCfg`, `workspacePath`.  
All other state in this group is ephemeral (discarded on transition to `running`).

### Group B -- Running and result

Stages: `running`, `saving`, `done`, `error`

User journey: assessment executes, results display, user navigates back.

State consumed at start of group B: the four values listed above from group A.  
State produced within group B: `progressLines`, `legCallLines`, `result`.

**Challenge sub-phases (per-leg, within `running`):** After each `leg.complete` event the
orchestrator immediately runs two sequential challenge sub-flows inside the `running` stage:

- `leg.challenge.*` -- application-level challenge agents
- `leg.challenge-lz.*` -- landing zone challenge agents

These sub-flows execute per-leg (not once per run) and are internal to the orchestrator --
they do not correspond to a separate top-level stage in `LlmAssessmentScreen`. `exit_code:2`
means no challenge agents are configured; the phase short-circuits immediately. `agents:0`
confirms no agents ran. These events are emitted to `llm-assessments/swao/<run>/log.ndjson`
(see `@swao/module-llm-assessment/src/orchestrator.ts`).

The `RunningPhase` extraction (#2374) must preserve these sub-flows within the running stage.
Monitors must not treat `exit_code:2` as an error when `agents:0`. UAT evidence: #2411.

---

## 4. Prop interface contracts

### 4.1 Shared orchestrator props

```typescript
// src/tui/screens/LlmAssessmentScreen.tsx (post-refactor)
export interface LlmAssessmentScreenProps {
  workspaceRoot?: string;
  onBack: () => void;
}
```

The orchestrator (`LlmAssessmentScreen`) retains only: stage routing state, `onBack` wiring, and the boundary state that crosses from group A to group B. It delegates rendering to the two phase components.

### 4.2 LegBuildingPhase props

```typescript
// src/tui/assess/LegBuildingPhase.tsx
export type LegBuildingStage =
  | 'loading'
  | 'picking-app'
  | 'no-apps'
  | 'no-legs'
  | 'build-legs'
  | 'pick-model'
  | 'pick-model-custom'
  | 'health-check'
  | 'review-config';

export interface LegBuildingPhaseProps {
  stage: LegBuildingStage;
  workspacePath: string;
  onReady: (config: LegBuildingResult) => void;
  onBack: () => void;
}

export interface LegBuildingResult {
  selectedApp: EligibleApp;
  resolvedLegs: ResolvedLeg[];
  llmCfg: SwaoYmlLlmAssessment;
  workspacePath: string;
}
```

`onReady` fires once when the user confirms at `review-config`. The orchestrator transitions to `running` upon receiving it.

### 4.3 RunningPhase props

```typescript
// src/tui/assess/RunningPhase.tsx
export type RunningStage = 'running' | 'saving' | 'done' | 'error';

export interface RunningPhaseProps {
  stage: RunningStage;
  selectedApp: EligibleApp;
  resolvedLegs: ResolvedLeg[];
  llmCfg: SwaoYmlLlmAssessment;
  workspacePath: string;
  onBack: () => void;
}
```

RunningPhase owns its own progress-line and result state; these do not need to live in the orchestrator.

### 4.4 useLlmPing hook contract

Extracted to `@swao/tui-kit/src/hooks/useLlmPing.ts` (#2375).

```typescript
// packages/@swao/tui-kit/src/hooks/useLlmPing.ts

export type LlmPingStatus = 'idle' | 'running' | 'ok' | 'fail';

export interface LlmPingResult {
  status: LlmPingStatus;
  message: string;
  permanent: boolean;
}

export interface UseLlmPingOptions {
  /** The loaded connector to ping. Null/undefined disables the hook. */
  connector: LoadedConnector | null | undefined;
  /** The model string to test (used in the ping request body). */
  model: string;
  /** Fires on every status change. */
  onChange?: (result: LlmPingResult) => void;
}

export function useLlmPing(options: UseLlmPingOptions): LlmPingResult;
```

The hook is stateful -- it manages its own `AbortController`, cleans up on unmount, and fires `onChange` on transitions. Callers do not need to manage the async lifecycle.

### 4.5 SetupWizard step contract

Each wizard step becomes a standalone functional component in `src/tui/wizard/steps/`.

```typescript
// src/tui/wizard/steps/<step>.tsx

export interface WizardStepProps {
  /** 1-indexed position shown in the step header ("Step N of 7"). */
  stepNumber: number;
  /** Called when the step is complete; parent advances the index. */
  onNext: () => void;
  /** Called when the user presses Escape; parent decrements or cancels. */
  onBack: () => void;
  workspaceRoot?: string;
}
```

Each step file exports exactly one default component matching this interface. Shared utility (progress indicators, GuidanceBox wiring, `_wizardGuidanceOpen`) lives in `src/tui/wizard/shared.ts`.

---

## 5. Directory layout after extraction

```
src/tui/
  screens/
    LlmAssessmentScreen.tsx    -- thin orchestrator (~150 lines post-refactor)
    SetupWizard.tsx            -- thin orchestrator (~120 lines post-refactor)
    CredentialScreen.tsx       -- unchanged (already well-scoped)
    ...                        -- other screens unchanged
  assess/
    LegBuildingPhase.tsx       -- stages: loading -> review-config
    RunningPhase.tsx           -- stages: running -> done/error
    shared.ts                  -- EligibleApp resolver, leg deduplication, LlmResultTable
  wizard/
    steps/
      ProviderStep.tsx         -- step 1: LLM provider picker
      ProviderModelStep.tsx    -- step 1b: model selection sub-step
      CredentialsStep.tsx      -- step 3: credential entry (#2381 fix source)
      HealthCheckStep.tsx      -- step 4: MCP / Claude Desktop detection
      PlaywrightStep.tsx       -- step 5: Playwright install
      ReadyStep.tsx            -- step 7: scaffold and launch
    shared.ts                  -- _wizardGuidanceOpen pattern, step-header renderer
```

---

## 6. Extraction sequence (implementation order)

The extraction is ordered to keep a green test baseline at each step and to avoid merging a "half-extracted" monolith:

| Step | Issue | Deliverable | Depends on |
|---|---|---|---|
| 1 | #2375 | `useLlmPing` hook + unit tests in `@swao/tui-kit` | -- |
| 2 | #2373 | `LegBuildingPhase` extracted; interfaces in `assess/` | #2375 |
| 3 | #2374 | `RunningPhase` extracted; `LlmResultTable` moved to `assess/shared.ts` | #2373 |
| 4 | #2376 | `LlmAssessmentScreen` wired as thin orchestrator | #2373, #2374 |
| 5 | #2377 | SetupWizard steps extracted to `wizard/steps/` | -- (parallel to 1-4) |
| 6 | #2369 | `AppAssessmentScreen` typed wrapper in App.tsx router | #2376 |
| 7 | #2370 | `LzAssessmentScreen` stub wired in App.tsx router | #2376 |
| 8 | #2371 | Shared assess utilities consolidated in `assess/shared.ts` | #2373, #2374 |
| 9 | #2372 | App.tsx assess router updated to use typed screen names | #2369, #2370, #2371 |

Design note: steps 1-4 (LlmAssessmentScreen decomposition) and step 5 (SetupWizard steps) are independent and may be worked concurrently if the sprint session has capacity.

---

## 7. Test strategy

### 7.1 useLlmPing (step 1 -- mandatory before code moves)

Per advisor guidance (sprint-130 kickoff): the hook must have unit tests covering:

- Per-protocol URL construction (OpenAI, Anthropic, Ollama, Azure)
- Correct auth header injection per provider
- Request body structure
- Timeout transition: `running` -> `fail` with `permanent: false`
- Happy path: `running` -> `ok`
- Permanent-fail classification (e.g. 401 Unauthorized -> `permanent: true`)

Tests live in `packages/@swao/tui-kit/src/hooks/useLlmPing.test.ts`.

### 7.2 Phase components (steps 2-4)

Each extraction commit adds a render-smoke test:

- Mount `<LegBuildingPhase stage="picking-app" .../>` -- assert renders without crash
- Mount `<RunningPhase stage="done" .../>` -- assert renders without crash

Exhaustive Ink interaction tests are deferred (low ROI on headless, per sprint-129 retro).

### 7.3 Parity gate

Before each extraction commit, run:

```bash
pnpm --filter swao test --run
pnpm --filter @swao/tui-kit test --run
```

Both must pass. Any test delta is a regression, not a known skip.

---

## 8. Behaviour-freeze net

The extraction must produce no observable behaviour change in any stage. Verification approach:

1. Before extraction: record the render output for each stage using the existing test fixtures (or a new snapshot per phase).
2. After extraction: confirm snapshots match.
3. Any diff in GuidanceBox content, stage label, or navigation handler is a regression.

Stages `running` and `done` include the `LlmResultTable` component. `LlmResultTable` has no internal state; its move to `assess/shared.ts` is a pure relocation with no logic change.

---

## 9. Deferred items

The following are explicitly deferred beyond sprint-130:

- Full Ink interaction tests (keypresses, cursor movement) for each phase component -- deferred to a dedicated TUI test sprint.
- `LzAssessmentScreen` full implementation (#2370 delivers only the router stub and empty screen skeleton; full LZ assessment logic is a separate epic post-v1.0.0).
- `AppAssessmentScreen` as a standalone concept vs. a typed wrapper -- #2369 delivers the typed router entry; the naming is cosmetic until a second assessment type shares the wrapper.

---

*Document ends.*
