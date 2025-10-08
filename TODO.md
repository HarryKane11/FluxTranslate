# FluxTranslate Roadmap (UX + AI)

Legend: Priority [P0]=must, [P1]=important, [P2]=nice; Tags [UX] [AI] [Perf] [Reliability] [Dev] [Doc]

## P0 — Must‑Have UX
- [UX] API key toast on error with “Open Options” action.
- [UX] Panel controls: Translate/Stop/Restore (Stop cancels current run).
- [UX] Domain auto‑translate control: sites.always / sites.never (+ popup toggles).
- [UX] Keyboard shortcuts: translate / restore / selection.
- [UX] Selection mini‑bubble (“Translate”), copy original/translated.
- [UX] ALT key: hover original text while held.
- [UX] Import/Export settings + Glossary; Cache controls (size, clear, stats).

## P1 — AI Features
- [AI] Explain Selection (gloss + simple explanation in target lang).
- [AI] Summarize Page to overlay.
- [AI] Alternative translations (alts per item; optional).
- [AI] Tone presets + per‑domain auto style.
- [AI] Provider fallback chain on 429/5xx.
- [AI] Language auto‑detect to skip needless translation.
- [AI] Term extraction → glossary suggestions.

## P1 — Perf/Reliability
- [Reliability] Backoff+retry for all providers (OpenAI/Anthropic/Gemini/Groq unified).
- [Perf] Batch token budget approximation.
- [Perf] MutationObserver throttling; viewport prioritization.

## P2 — A11y/Docs/Dev
- [UX] A11y pass (ARIA, focus rings, high contrast).
- [Doc] README: Ctrl/⌘+Click element translate, panel use, restricted pages.
- [Dev] Settings schema docs; unit tests for `safeJson`, glossary, batching.

## Status (current Sprint)
- Added: commands, domain auto‑translate, panel buttons, cache limit/stats, options import/export + site lists.
- Next: error toasts; selection bubble; ALT‑original; provider backoff generalization.

