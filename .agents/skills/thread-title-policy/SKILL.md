---
name: thread-title-policy
description: Create and validate T3 Code automatic thread-title policies with deterministic PR, issue, Radar, Linear, or custom identifier prefixes, model-written descriptions, rename cadence, and examples. Use when a user wants to customize auto-title behavior, add an identifier rule, or diagnose why a title did not pick up an identifier.
---

# Thread Title Policy

Create a `TitlePolicy` JSON document using the authoritative schema in `packages/contracts/src/titlePolicy.ts`.

## Workflow

1. Ask which identifiers matter and request a real reference or URL for each custom identifier.
2. Confirm the desired prefix. Built-in `urlKind` values cover `github_pull`, `github_issue`, and `radar`. For anything else, derive a `urlMatches` glob containing `{number}` or `{identifier}` from 2–3 real examples. Never invent a custom pattern without examples.
3. Gather concise guidance for the model-written description. Flag guidance that contradicts a deterministic prefix rule.
4. Confirm or default `maxCharacters` to 50, `refreshEveryTurns` to 4, `renameOnGoalChange` to true, and `preserveManualTitles` to true.
5. Require at least one realistic input and exact expected title per rule.
6. Assemble JSON with `version: 1`, `enabled`, `defaults`, `rules`, `suggestions`, and `examples`.
7. Save it to a temporary JSON file and run `bun run .agents/skills/thread-title-policy/scripts/validate-policy.ts <path>` until validation passes.
8. Return the final JSON and direct the user to Settings → General → Thread title policy. Have them click “Test policy against examples” for live model validation.

Set `enabled: false` when the user wants auto-renaming disabled. Do not use an empty rule list as a substitute, because description-only refreshes would still run.
