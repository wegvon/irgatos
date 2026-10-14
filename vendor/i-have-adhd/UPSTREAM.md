# i-have-adhd 0.4.1

Source: https://github.com/ayghri/i-have-adhd

Upstream commit: `1ecea1993b7fce257ffbd686c070948b5e07eda6` (2026-10-11).

Copyright (c) 2026 Ayoub Ghriss. MIT license, kept verbatim in `LICENSE`.

`SKILL.md` is `skills/i-have-adhd/SKILL.md` from that commit, unmodified. It is
the canonical ruleset; Irgatos imports it as text and hands it to agents when
ADHD mode is on (`src/features/adhd/model/adhdRules.ts`).

Irgatos adapts the upstream harness integrations rather than copying them:

- The always-on hook and the Pi extension's `syncContext` inject the ruleset
  once per provider conversation and a one-line "ADHD MODE OFF" notice when it
  is turned off. Irgatos does the same in its own turn pipeline.
- `/i-have-adhd [on|off]` and the stop phrases "stop adhd mode" and
  "normal mode" work in every Irgatos composer and are handled by the app, so
  they never reach the agent.
- The Pi extension's "● ADHD ON" status is the status bar chip.

To update, replace `SKILL.md` with the new upstream file and bump the version
and commit above. The rules version the app tracks is derived from the file's
contents, so open chats receive the new rules on their next turn.
