---
title: TUI
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->

# Terminal UI (TUI)

SWAO includes a full-screen terminal interface for exploring assessment findings without
leaving the terminal. The TUI is built on [Ink](https://github.com/vadimdemedes/ink) and
renders directly in your existing shell session.

## Launching the TUI

Start an assessment in interactive mode:

```bash
swao assess --app <name> --interactive
```

Or re-open the TUI for an already-completed assessment:

```bash
swao assess --app <name> --interactive --skip-run
```

## TUI Layout

```
+-----------------------------------------------------------+
|  SWAO  |  payment-service  |  GDPR  |  24 findings       |
+-----------------------------------------------------------+
|  FINDINGS                 |  CONTROL DETAIL              |
|                           |                              |
|  > ART-5  Data minimisa.. |  ART-5  Data minimisation   |
|    ART-6  Lawful basis    |  Status: FAIL                |
|    ART-13 Privacy notice  |  Severity: HIGH              |
|    ART-32 Security meas.. |                              |
|    ART-35 DPIA required   |  Evidence:                   |
|    ART-44 Third-country.. |  src/user/profile.ts:42      |
|           ...             |  "fields: name, dob, ssn,    |
|                           |   marketing_prefs, location" |
+-----------------------------------------------------------+
|  [Arrow keys] Navigate  [Enter] Expand  [Ctrl+G] Collapse |
|  [F] Filter  [S] Sort   [E] Export      [Q] Quit          |
+-----------------------------------------------------------+
```

## Key Bindings

| Key | Action |
|-----|--------|
| `Arrow Up / Down` | Move between findings in the list |
| `Arrow Left / Right` | Switch focus between panels |
| `Enter` | Expand a finding to show full evidence |
| `Ctrl+G` | Collapse all expanded findings |
| `F` | Open the filter panel (by status, severity, control domain) |
| `S` | Cycle sort order (severity, control ID, status) |
| `E` | Export the current filtered view to HTML |
| `Q` | Quit the TUI and return to the shell |

## Finding Status Icons

| Icon | Meaning |
|------|---------|
| `PASS` | Control satisfied -- evidence found, no gap detected |
| `FAIL` | Control violated -- gap confirmed with evidence |
| `WARN` | Partial compliance -- evidence ambiguous or incomplete |
| `INFO` | Informational finding -- no compliance verdict |
| `SKIP` | Control not applicable to this workload type |

## Filtering Findings

Press `F` to open the filter panel. Available filters:

- **Status**: PASS / FAIL / WARN / INFO / SKIP
- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **Domain**: Data Protection, Access Control, Incident Management, ...

Filters combine with AND logic. Press `Escape` to close the panel and apply.

## Exporting from the TUI

Press `E` to generate an HTML report of the currently visible (filtered) findings. The report
is written to the path configured in `outputPath` (default: `./swao-output`). The TUI
displays the output path on completion.

## Accessibility

The TUI requires a terminal with at least 80 columns and 24 rows. It respects the
`NO_COLOR` environment variable to suppress colour output for screen readers.

## Tips

- Run `swao doctor` before the first assessment to confirm that your terminal supports the
  rendering requirements.
- If the layout breaks, resize your terminal window and the TUI redraws automatically.
- Use `Ctrl+G` after filtering to collapse all expanded items and get a clean overview.
