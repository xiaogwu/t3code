import {
  DEFAULT_SERVER_SETTINGS,
  TitlePolicy,
  type TitlePolicyPreviewResult,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const decodeTitlePolicy = Schema.decodeUnknownSync(Schema.fromJsonString(TitlePolicy));
const format = (policy: TitlePolicy) => JSON.stringify(policy, null, 2);

/**
 * The title policy as one JSON document: identifier prefixes, exact title
 * templates, and how often titles refresh. Applying replaces it whole.
 */
export function TitlePolicySettings() {
  const saved = useScopedSettings((settings) => settings.titlePolicy);
  const mixed = useScopedSettingsMixed(["titlePolicy"]);
  const updateSettings = useUpdateScopedSettings();
  const { target } = useSettingsScope();
  const savedJson = format(saved);
  // The draft follows the saved policy until the user edits it.
  const [draft, setDraft] = useState<{ readonly base: string; readonly text: string } | null>(null);
  const text = draft !== null && draft.base === savedJson ? draft.text : savedJson;
  const dirty = text !== savedJson;
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReadonlyArray<TitlePolicyPreviewResult> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const runPreview = useAtomCommand(serverEnvironment.previewTitlePolicy, {
    reportFailure: false,
  });
  const environmentId = target?.environmentId ?? null;
  const canPreview = useAtomValue(
    serverEnvironment.previewTitlePolicy.permissionAtom(environmentId),
  );

  const parse = () => {
    try {
      const policy = decodeTitlePolicy(text);
      setError(null);
      return policy;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The policy is not valid JSON.");
      return null;
    }
  };
  const edit = (next: string) => {
    setDraft({ base: savedJson, text: next });
    setError(null);
    setPreview(null);
  };

  return (
    <SettingsRow
      serverScoped
      settingKeys={["titlePolicy"]}
      {...searchableSetting("thread-title-policy")}
      description="Rules for automatic thread titles: fixed prefixes such as PR#123:, exact title templates with {today:MM/DD/YYYY} and {now:HH:mm}, and how many turns pass between refreshes. Titles you or an agent rename stay as they are."
      resetAction={
        mixed || !Equal.equals(saved, DEFAULT_SERVER_SETTINGS.titlePolicy) ? (
          <SettingResetButton
            label="thread title policy"
            onClick={() => updateSettings({ titlePolicy: DEFAULT_SERVER_SETTINGS.titlePolicy })}
          />
        ) : null
      }
      control={
        <div className="flex items-center gap-1.5">
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => edit(savedJson)}>
              Discard
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              const policy = parse();
              if (policy !== null) updateSettings({ titlePolicy: policy });
            }}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="mt-3 flex max-w-2xl flex-col items-start gap-2 pb-3.5">
        <Textarea
          aria-label="Thread title policy JSON"
          aria-invalid={error !== null || undefined}
          rows={14}
          spellCheck={false}
          value={mixed && !dirty ? "" : text}
          placeholder={
            mixed ? "Mixed. Apply a policy to use it on all selected targets." : undefined
          }
          onChange={(event) => edit(event.target.value)}
        />
        {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button
          size="xs"
          variant="outline"
          disabled={environmentId === null || !canPreview || previewing}
          onClick={() => {
            const policy = parse();
            if (policy === null || environmentId === null) return;
            setPreviewing(true);
            void runPreview({ environmentId, input: { policy } }).then((result) => {
              setPreviewing(false);
              if (result._tag === "Success") setPreview(result.value);
              else if (!isAtomCommandInterrupted(result))
                setError(`Preview failed: ${String(squashAtomCommandFailure(result))}`);
            });
          }}
        >
          {previewing ? "Testing examples…" : "Test against examples"}
        </Button>
        {preview !== null ? (
          <ul className="space-y-1 text-xs">
            {preview.map((result) => (
              <li
                key={`${result.example.previousTitle ?? ""}\n${result.example.thread}`}
                className={result.pass ? "text-foreground" : "text-destructive"}
              >
                {result.pass ? "✓" : "✗"} {result.actual}
                {result.pass ? null : (
                  <span className="text-muted-foreground">
                    {" "}
                    (expected {result.example.expected})
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SettingsRow>
  );
}
