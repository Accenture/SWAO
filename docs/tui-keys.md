# Keys in the terminal interface

Every screen of the SWAO terminal interface (`swao menu`) uses the same keys. The line of key hints above the guidance box shows the keys that work on the current screen.

## Keys

| Key | What it does | Where it applies |
|---|---|---|
| Enter | Next: confirms the step and moves on; also confirm, open, select | Every screen |
| ↑ ↓ | Moves the cursor | Lists and menus |
| ← | Back to the previous step; the values you entered are kept | Lists, summaries, confirmations and result screens |
| Shift+Tab | Back to the previous step; the values you entered are kept | Inside a text input, where ← moves the text cursor |
| → | Forward to a step already completed in this pass | Step flows (not in the Setup Wizard: Enter completes a step there) |
| Space | Selects or clears an entry | Multi-select lists |
| Esc | Leaves the flow and returns to the main menu; cancels a running process | Every screen |
| Ctrl+G | Opens or closes the guidance box | Every screen with a guidance box |
| PgUp PgDn | Pages the guidance box or a long list | When it has more than one page |
| 1 to 9 | Selects a numbered entry | Only on lists that show numbers |
| Letters | Only when a visible menu entry or the key hints name the letter | Rare |
| Ctrl+C | Asks to quit; a second Ctrl+C within 2 seconds quits SWAO | Every screen |

## What Esc does, in order

One press of Esc does one thing, in this order:

1. An open guidance box closes.
2. An open abort question closes and you stay on the screen.
3. A running process (assessment, refresh, research, probe) is cancelled. For long runs SWAO asks first; the results so far are kept as a cancelled run.
4. Otherwise the flow ends and the main menu opens. When the flow holds input that is not saved yet, SWAO asks first.

Esc never skips a step. An optional step has "Skip this step" as the last entry of its list.

## The key hints per screen

| Screen | Key hints |
|---|---|
| Menu | `↑↓ select   Enter open   Esc abort` |
| Picker in a flow | `↑↓ select   Enter next   ← back   Esc abort` |
| Multi-select in a flow | `↑↓ select   Space toggle   Enter next   ← back   Esc abort` |
| Text input in a flow | `Enter next   Shift+Tab back   Esc abort` |
| Confirmation | `Enter confirm   ← back   Esc abort` |
| Running process | `Esc cancel` |
| Last step or finish screen | `↑↓ select   Enter finish   Esc abort` |
| Abort question | `Enter abort   Esc stay` |

## Tips

- Arrow keys, number keys, Space and Enter keep working while the guidance box is open; the box follows the highlighted entry.
- A long list scrolls with ↑ and ↓ and pages with PgUp and PgDn. Where the terminal passes the mouse wheel on as arrow keys (Windows Terminal does), the wheel moves the selection the same way.
- Pasted text goes into the input as one piece; in the chat a pasted line break does not send the message.

See also: [Tools](/tools) | [Workspace Setup](/workspace-setup)
