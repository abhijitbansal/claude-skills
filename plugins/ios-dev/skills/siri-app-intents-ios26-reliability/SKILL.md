---
name: siri-app-intents-ios26-reliability
description: Building or debugging Siri voice invocation for App Intents / App Shortcuts on iOS 26 — phrases not recognized, Siri routing to the wrong app or web search, parameterized phrases only matching some values, "Hey Siri ask <app>" failing for arbitrary user vocabulary, or deciding how many shortcuts/phrases to register. Use whenever work touches AppShortcutsProvider, AppShortcutPhrase, donated vocabulary, or Siri invocation reliability.
---

# Siri App Shortcuts on iOS 26: reliability under the phrase quota

Evidence: one shipped feature (inventory voice queries), device-verified (s0044).
Platform caps below are iOS-26-observed — **verify against current docs before
relying on exact numbers** (dated 2026-07; OS-version-volatile).

## The matching model

- Parameterized App Shortcut phrases (`\(.$item)`) match **only pre-donated
  vocabulary** — Siri does not do open dictation into a parameter. If the user's word
  wasn't donated, the phrase silently fails or misroutes.
- Observed iOS 26 constraints: `applicationName` is mandatory in every registered
  phrase; ~10-shortcut cap per app; roughly a 1000-donated-phrase budget; Siri
  misroutes are not interceptable by the app; a renamed personal Shortcut is the only
  app-name-free voice path.

## The reliable pattern

1. **Catch-all phrases + value dialog.** Register non-parameterized catch-all phrases
   ("ask <app>…") that open a value dialog, so vocabulary outside the donated top-N
   still has a working path — the parameterized phrase is the fast path, never the
   only path.
2. **Ranked donation vocabulary.** Donate the top-N terms by real usage (names, tags),
   re-donated as inventory changes.
3. **Dense-rank the recency tiebreak.** When ranking donation candidates with a
   same-timestamp tiebreak, use dense rank, not position rank — position rank after a
   timestamp collision skips ranks and silently drops donation slots. (Real algorithm
   bug, caught in review, not by the implementer.)
