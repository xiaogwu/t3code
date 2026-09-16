import DateTimePicker from "@expo/ui/community/datetime-picker";
import {
  resolveSnoozeDuration,
  resolveSnoozeForDefault,
  snoozeForTimeError,
  type SnoozeDurationUnit,
} from "@t3tools/client-runtime/state/thread-settled";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useThreadShell } from "../../state/entities";
import { useThreadListActions } from "../home/useThreadListActions";

type SnoozeForRouteParams = {
  readonly environmentId: string;
  readonly threadId: string;
};

/** "Until a moment" and "for a stretch of time" are the same choice phrased two
    ways, so one screen carries both. Only iOS gets the date-and-time half: the
    picker is `@expo/ui`'s native one, which Android does not have — which is why
    Android opens straight into the duration form instead of a dead end. */
type SnoozeMode = "until" | "for";

const DURATION_UNITS: ReadonlyArray<{
  readonly value: SnoozeDurationUnit;
  readonly label: string;
}> = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

const MODE_OPTIONS: ReadonlyArray<{ readonly value: SnoozeMode; readonly label: string }> = [
  { value: "until", label: "Until" },
  { value: "for", label: "For" },
];

export function SnoozeForRouteScreen({ route }: StaticScreenProps<SnoozeForRouteParams>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const thread = useThreadShell({
    environmentId: EnvironmentId.make(route.params.environmentId),
    threadId: ThreadId.make(route.params.threadId),
  });
  const { snoozeThread } = useThreadListActions();
  const [mode, setMode] = useState<SnoozeMode>(Platform.OS === "ios" ? "until" : "for");
  const [value, setValue] = useState(() => resolveSnoozeForDefault(new Date()));
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<SnoozeDurationUnit>("hours");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleValueChange = useCallback((selected: Date) => {
    setValue(selected);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;

    // Re-read the clock here: the picked time can expire while the screen is
    // open, and a duration is measured from the moment it is confirmed.
    const now = new Date();
    let snoozedUntil: Date;
    if (mode === "until") {
      const validationError = snoozeForTimeError(value, { now });
      if (validationError !== null) {
        setError(validationError);
        return;
      }
      snoozedUntil = value;
    } else {
      const result = resolveSnoozeDuration({ amount, unit }, { now });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      snoozedUntil = result.value;
    }
    if (thread === null) {
      Alert.alert(
        "Could not snooze thread",
        "This thread is no longer available. Return to the thread list and try again.",
      );
      return;
    }

    setIsSubmitting(true);
    const succeeded = await snoozeThread(thread, snoozedUntil.toISOString());
    if (succeeded) {
      navigation.goBack();
      return;
    }
    setIsSubmitting(false);
  }, [amount, isSubmitting, mode, navigation, snoozeThread, thread, unit, value]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions
        options={{
          title: mode === "until" ? "Snooze until" : "Snooze for",
        }}
      />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-5">
          <View className="gap-4 rounded-[24px] border-continuous bg-card p-4">
            <View className="gap-1">
              <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                Wake this thread
              </Text>
              <Text className="text-sm leading-normal text-foreground-secondary">
                The thread stays out of the inbox until this time, unless it needs you sooner.
              </Text>
            </View>

            {Platform.OS === "ios" ? (
              <SegmentedControl
                options={MODE_OPTIONS}
                selected={mode}
                onSelect={(next) => {
                  setMode(next);
                  setError(null);
                }}
                size="compact"
              />
            ) : null}

            {mode === "until" ? (
              <DateTimePicker
                display="compact"
                minimumDate={new Date()}
                mode="datetime"
                onValueChange={(_event, selected) => handleValueChange(selected)}
                style={{ alignSelf: "stretch" }}
                value={value}
              />
            ) : (
              <View className="gap-3">
                <TextInput
                  accessibilityLabel="How long to snooze for"
                  className="rounded-xl border border-border bg-screen px-3 py-2.5 text-base text-foreground"
                  keyboardType="numeric"
                  onChangeText={(next) => {
                    setAmount(next);
                    setError(null);
                  }}
                  returnKeyType="done"
                  selectTextOnFocus
                  value={amount}
                />
                <SegmentedControl
                  options={DURATION_UNITS}
                  selected={unit}
                  onSelect={(next) => {
                    setUnit(next);
                    setError(null);
                  }}
                  size="compact"
                />
              </View>
            )}

            {error !== null ? (
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {error}
              </Text>
            ) : null}

            <ConnectionSheetButton
              disabled={isSubmitting}
              icon="clock"
              label={isSubmitting ? "Snoozing..." : "Snooze thread"}
              onPress={() => {
                void handleSubmit();
              }}
              tone="primary"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
