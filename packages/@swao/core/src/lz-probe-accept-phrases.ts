/**
 * #4460: the closing sentences of the landing zone read-only gate message that name a
 * CLI flag. The CLI prints them as they are (module-landing-zone live/session.ts); the
 * TUI replaces each with its own choice (module-app-assessment tui/assess/lz-live-flow.ts),
 * so the flag text lives here once and never in TUI source (G-11, Design 126 section 13.2).
 */
export const LZ_ACCEPT_WRITE_CAPABLE_PHRASE = 'or pass --accept-write-capable-credentials for this run.';
export const LZ_ACCEPT_UNVERIFIED_PHRASE = 'Pass --accept-unverified-read-only for this run to continue.';
