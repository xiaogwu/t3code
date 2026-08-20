# Fork feature index

Features this fork adds on top of upstream `t3code`, newest first. Upstream nightly merges
are omitted: this is only the fork's own work.

No feature has a PR to link, because features land as local merges into `integration`. The
compare link stands in for the PR diff: the topic branch measured against the base it was
merged onto.

## Workflow

One local topic-branch merge per feature. Pull requests were tried and dropped on 2026-08-17:
CI never runs on this fork, so a PR adds a round trip and reviews nothing. Only PR #2 ever
completed. PR #1 was lost when a local merge pushed its commits into `integration`, which made
GitHub auto-close the still-draft PR.

1. Branch off `integration`, kebab-case, prefixed by area (`ui/...`, `build/...`, `fork/...`).
2. Commit the work there and run the gates for the packages you touched.
3. `git merge --no-ff <branch> -m "merge: <one-line description>"` onto `integration`.
4. Add the feature's row to the table below and commit it on `integration`.
5. Push `integration`.

Step 4 is part of landing a feature, not a chore for later. Skipping it is how the index went
five features stale between 2026-08-15 and 2026-08-20. It is its own commit rather than part of
the merge because the row cites the merge commit, which does not exist until step 3. Fill
**Merge** with that SHA, and **Diff** with `compare/<the commit integration was on>...<the
topic branch tip>`. Capture the topic branch tip before deleting the branch; three branches
from 2026-08-18 had to be recovered from a reflog in another clone.

Upstream nightly merges and upstream-reconciliation merges do not get rows.

## Features

| Date       | Feature                                                           | Topic branch                      | Merge                                                                                            | Diff                                                                                                                                     |
| ---------- | ----------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-18 | little-coder provider gets its own icon                           | `fork/little-coder-provider-icon` | [`023c1d7c6`](https://github.com/xiaogwu/t3code/commit/023c1d7c63550e5563b6449c5769f47cb9e49c87) | [compare](https://github.com/xiaogwu/t3code/compare/92611da8844e3e29a9649752c40a7a88515c2c99...9256d0087825051a475a719694471c616a9b3d9f) |
| 2026-08-18 | One reply affordance per assistant message                        | `fork/single-reply-affordance`    | [`bb60c6d1c`](https://github.com/xiaogwu/t3code/commit/bb60c6d1cd2abf0ac8fa63b1fb03372a07260a23) | [compare](https://github.com/xiaogwu/t3code/compare/9382984d04540554afff1e27e3fa2d35fa1025bd...91376e1a80147f34593c9d076193a2675dc0043d) |
| 2026-08-18 | pi provider instance shows the pi logo                            | `fork/pi-provider-logo`           | [`9382984d0`](https://github.com/xiaogwu/t3code/commit/9382984d04540554afff1e27e3fa2d35fa1025bd) | [compare](https://github.com/xiaogwu/t3code/compare/53a1c3a7dbcd624a8a50189edf9072b908b75bb8...574a245b7112c218ddfcf6a0532366c41fb382ea) |
| 2026-08-18 | Thread output no longer blanks when the right panel opens         | `ui/thread-blank-on-panel-toggle` | [`53a1c3a7d`](https://github.com/xiaogwu/t3code/commit/53a1c3a7dbcd624a8a50189edf9072b908b75bb8) | [compare](https://github.com/xiaogwu/t3code/compare/86dc609cedc6704c8696f6c0f08f81a5119d04a5...3af8715d1581e914382070aaf38a617956502ce5) |
| 2026-08-17 | Search archived threads from the command palette                  | `archived-thread-search`          | [`c777e5800`](https://github.com/xiaogwu/t3code/commit/c777e5800dbdab144d27bc22b8efa22e30390923) | [compare](https://github.com/xiaogwu/t3code/compare/cccd340d6ae267e9ad81bec922bc01140e7ef0ae...b58be7206031bca2afa1895a3a09e3444689808a) |
| 2026-08-15 | OpenCode prelaunch command, plus repeatable reply anchors         | `opencode-prelaunch-command`      | [`72ae6bb5f`](https://github.com/xiaogwu/t3code/commit/72ae6bb5fb363b12dff465ba63a35044e0e6389c) | [compare](https://github.com/xiaogwu/t3code/compare/13cae54a2bc963fca2ad010afd9acecff82e7d6e...6affe6d0e5680f628918e89c712e126fcc8fa644) |
| 2026-08-12 | Sidebar status dots restored, reply to individual response blocks | `fork-integration`                | [`d726830c2`](https://github.com/xiaogwu/t3code/commit/d726830c249d60c0bcd72a45d137b0f90e72c72d) | [compare](https://github.com/xiaogwu/t3code/compare/d99ba4e8983e4c8e82f615d94f2630ccc22fe1d9...70827cbf24de4e04c71b7c3e3cc9e5ccbff3f82e) |
| 2026-08-11 | Sidebar v2 gets its own thread sort order                         | `ui/sidebar-v2-thread-sort`       | [`a6b3e80f0`](https://github.com/xiaogwu/t3code/commit/a6b3e80f051749f87b52f6641873785c50457f1e) | [compare](https://github.com/xiaogwu/t3code/compare/e52a4f8d29dc921fa424f254f17c54046a73f0ea...63e93706e002a9a76bd47ed04896b36f5cae3221) |
| 2026-08-11 | Filter threads by state in Cmd+K search                           | `ui/cmdk-filter-thread-state`     | [`e52a4f8d2`](https://github.com/xiaogwu/t3code/commit/e52a4f8d29dc921fa424f254f17c54046a73f0ea) | [compare](https://github.com/xiaogwu/t3code/compare/d3bd96149458de694142e6c409969bb5a46fb60a...6bfed00686e98d7bed8dff1c3fe202136fbfe7a0) |
| 2026-08-11 | Gemini CLI provider                                               | `ui/gemini-cli-provider`          | [`d3bd96149`](https://github.com/xiaogwu/t3code/commit/d3bd96149458de694142e6c409969bb5a46fb60a) | [compare](https://github.com/xiaogwu/t3code/compare/c8e997696b5e207a0fe44a414b01863d5353ce8b...d0883eec2c5c6afdd0ec9b8cd9e13169a1225b7c) |
| 2026-08-11 | Reply to a specific message in a thread                           | `ui/reply-to-message`             | [`c8e997696`](https://github.com/xiaogwu/t3code/commit/c8e997696b5e207a0fe44a414b01863d5353ce8b) | [compare](https://github.com/xiaogwu/t3code/compare/a2a76ed42906bb5decef9a0cb80729a0434c49e9...33191615d399a18ad6f5a97ee30d84ab2698c206) |
| 2026-08-11 | Thread activity completion sounds                                 | `ui/agent-sounds`                 | [`a2a76ed42`](https://github.com/xiaogwu/t3code/commit/a2a76ed42906bb5decef9a0cb80729a0434c49e9) | [compare](https://github.com/xiaogwu/t3code/compare/d72df5e6a8a40516889e95cda23853ee89371ee0...3b4ade2bb89ecb436e0f48f17e03ebeb1682b19b) |
| 2026-08-11 | Toggle thread read state with mod+alt+u                           | `ui/thread-read-state-toggle`     | [`d72df5e6a`](https://github.com/xiaogwu/t3code/commit/d72df5e6a8a40516889e95cda23853ee89371ee0) | [compare](https://github.com/xiaogwu/t3code/compare/86d1df529b1ceae099d2db2ac4f7a095a342830b...dfe0e349b85c33fb72e7b9b6510bba86120feb7a) |
| 2026-08-11 | DEV blueprint artwork, including a real dark mode                 | `ui/dev-blueprint-artwork`        | [`86d1df529`](https://github.com/xiaogwu/t3code/commit/86d1df529b1ceae099d2db2ac4f7a095a342830b) | [compare](https://github.com/xiaogwu/t3code/compare/e290ac3e5970e61a4b28f33de0e81b3b4643200a...b7e79252973454bbac59b50410a730a0c453645c) |
| 2026-08-11 | DEV builds identify as a Dev stage and never auto-update          | `build/dev-stage-label`           | [`e290ac3e5`](https://github.com/xiaogwu/t3code/commit/e290ac3e5970e61a4b28f33de0e81b3b4643200a) | [compare](https://github.com/xiaogwu/t3code/compare/7d31e55bc39539b8974bb0ea49e62561cd21f4cd...eea7431df55aeba3f15b72ffa5140e2dfb6030f4) |
| 2026-08-11 | `--dev` packages with the blueprint icons                         | `build/dev-blueprint-icon`        | [`7d31e55bc`](https://github.com/xiaogwu/t3code/commit/7d31e55bc39539b8974bb0ea49e62561cd21f4cd) | [compare](https://github.com/xiaogwu/t3code/compare/1ab21d9c7e556b4de408abb54a1c9867cc46f80d...d7f62522fa044900be98dc1021a3dc9dd4b0d225) |
| 2026-08-11 | Package mac without `@electron/rebuild`                           | `build/mac-skip-electron-rebuild` | [`1ab21d9c7`](https://github.com/xiaogwu/t3code/commit/1ab21d9c7e556b4de408abb54a1c9867cc46f80d) | [compare](https://github.com/xiaogwu/t3code/compare/9c7622dac3d1a385351e6c74354a9e6b9c2037d5...05e6d62ee915d1767e06def568e1da59a1d2b910) |

Anything the fork carried before 2026-08-11 lived on the older `fork-integration` branch and
is not itemized here; read that branch's history directly.
