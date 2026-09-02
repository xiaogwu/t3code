# Antigravity

T3 Code can run Google Antigravity CLI (`agy`) as a provider. Install the CLI, run `agy` once to
sign in and trust your workspace, then restart T3 Code. Antigravity appears in the provider and
model pickers after the server confirms that `agy --version` and `agy models` work.

If the binary is not on the server's `PATH`, open **Settings → Providers → Antigravity** and set
**Binary path** to the full path to `agy`.

## Permissions

Antigravity's headless protocol cannot pause for an interactive approval. In approval-required
modes, it follows the allow rules in `~/.gemini/antigravity-cli/settings.json` and soft-denies tools
that still require confirmation. In T3 Code's **Full access** mode, T3 starts the turn with
`--dangerously-skip-permissions`.

Plan mode maps to Antigravity's `--mode plan`. Model changes take effect on the next turn.

## Current limitations

- Interactive tool approvals and structured follow-up questions are not available through the
  current Antigravity headless stream.
- Rewinding the provider conversation is not supported by the headless CLI.
- Image attachments are passed as local file paths so Antigravity can inspect them with its tools.
