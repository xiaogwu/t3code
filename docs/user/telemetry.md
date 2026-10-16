# Product usage data

The T3 Code server sends product usage events to PostHog, associated with a hashed account or
installation identifier. Events include the provider, model, reasoning effort, permission mode,
turn result, duration, and main-agent token totals when available.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

Collection is off by default. To opt in, set `T3CODE_TELEMETRY_ENABLED=true` in the server's
environment before starting it. This also enables T3 Connect relay tracing.
