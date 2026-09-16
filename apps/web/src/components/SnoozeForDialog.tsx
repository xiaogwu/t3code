import {
  resolveSnoozeDuration,
  resolveSnoozeForDefault,
  type SnoozeDurationUnit,
} from "@t3tools/client-runtime/state/thread-settled";
import { type FormEvent, useState, useSyncExternalStore } from "react";

import {
  closeSnoozeForDialog,
  readSnoozeForDialogState,
  subscribeSnoozeForDialog,
  type SnoozeForDialogState,
} from "../snoozeForDialog";
import { formatSnoozeForInput, parseSnoozeForInput } from "./Sidebar.snooze";
import { SnoozeDateTimePicker } from "./SnoozeDateTimePicker";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "./ui/number-field";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

const FORM_ID = "snooze-for-form";

const DURATION_UNITS: ReadonlyArray<{ readonly id: SnoozeDurationUnit; readonly label: string }> = [
  { id: "minutes", label: "minutes" },
  { id: "hours", label: "hours" },
  { id: "days", label: "days" },
];

/** "Until a moment" and "for a stretch of time" are the same choice phrased two
    ways, so they share one dialog rather than two menu entries. */
type SnoozeMode = "until" | "for";

function SnoozeForForm(props: {
  readonly request: Extract<SnoozeForDialogState, { readonly status: "open" }>;
}) {
  const { request } = props;
  const [mode, setMode] = useState<SnoozeMode>("until");
  const [input, setInput] = useState(() =>
    formatSnoozeForInput(resolveSnoozeForDefault(new Date())),
  );
  const [amount, setAmount] = useState<number | null>(2);
  const [unit, setUnit] = useState<SnoozeDurationUnit>("hours");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Re-read the clock here: a valid value can expire while the dialog is open,
    // and a duration is measured from the moment it is confirmed.
    const now = new Date();
    const result =
      mode === "until"
        ? parseSnoozeForInput(input, { now })
        : // A cleared stepper reads as null, which the shared validator rejects as
          // an empty amount.
          resolveSnoozeDuration({ amount: String(amount ?? ""), unit }, { now });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    closeSnoozeForDialog();
    request.onSnooze(result.value.toISOString());
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Snooze</DialogTitle>
        <DialogDescription>
          Choose when {request.threadCount === 1 ? "this thread" : "these threads"} should return to
          your inbox.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form id={FORM_ID} className="space-y-2" noValidate onSubmit={submit}>
          <ToggleGroup
            aria-label="Snooze mode"
            variant="segmented"
            value={[mode]}
            onValueChange={(next) => {
              const selected = next[0];
              if (selected !== "until" && selected !== "for") return;
              setMode(selected);
              setError(null);
            }}
          >
            <Toggle value="until">Until</Toggle>
            <Toggle value="for">Duration</Toggle>
          </ToggleGroup>
          {mode === "until" ? (
            <>
              <Label htmlFor="snooze-for-time">Date and time</Label>
              <SnoozeDateTimePicker
                id="snooze-for-time"
                form={FORM_ID}
                value={input}
                invalid={error !== null}
                {...(error ? { describedBy: "snooze-for-error" } : {})}
                onChange={(value) => {
                  setInput(value);
                  if (error) setError(null);
                }}
              />
            </>
          ) : (
            <>
              <Label htmlFor="snooze-for-amount">How long</Label>
              <div className="flex items-center gap-2">
                <NumberField
                  className="w-32"
                  min={1}
                  step={1}
                  value={amount}
                  onValueChange={(value) => {
                    setAmount(value);
                    if (error) setError(null);
                  }}
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease duration" />
                    <NumberFieldInput
                      id="snooze-for-amount"
                      aria-invalid={error !== null}
                      {...(error ? { "aria-describedby": "snooze-for-error" } : {})}
                    />
                    <NumberFieldIncrement aria-label="Increase duration" />
                  </NumberFieldGroup>
                </NumberField>
                <ToggleGroup
                  aria-label="Duration unit"
                  variant="segmented"
                  value={[unit]}
                  onValueChange={(next) => {
                    const selected = DURATION_UNITS.find((candidate) => candidate.id === next[0]);
                    if (!selected) return;
                    setUnit(selected.id);
                    if (error) setError(null);
                  }}
                >
                  {DURATION_UNITS.map((candidate) => (
                    <Toggle key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
              </div>
            </>
          )}
          {error ? (
            <p id="snooze-for-error" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeSnoozeForDialog}>
          Cancel
        </Button>
        <Button form={FORM_ID} type="submit">
          Snooze
        </Button>
      </DialogFooter>
    </>
  );
}

export function SnoozeForDialogHost() {
  const state = useSyncExternalStore(
    subscribeSnoozeForDialog,
    readSnoozeForDialogState,
    readSnoozeForDialogState,
  );

  return (
    <Dialog
      open={state.status === "open"}
      onOpenChange={(open) => {
        if (!open) closeSnoozeForDialog();
      }}
    >
      <DialogPopup className="max-w-sm">
        {state.status === "open" ? <SnoozeForForm key={state.id} request={state} /> : null}
      </DialogPopup>
    </Dialog>
  );
}
