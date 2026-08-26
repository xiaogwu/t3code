import DateTimePicker from "@expo/ui/community/datetime-picker";
import {
  resolveSnoozeForDefault,
  snoozeForTimeError,
} from "@t3tools/client-runtime/state/thread-settled";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useThreadShell } from "../../state/entities";
import { useThreadListActions } from "../home/useThreadListActions";

type SnoozeForRouteParams = {
  readonly environmentId: string;
  readonly threadId: string;
};

export function SnoozeForRouteScreen({ route }: StaticScreenProps<SnoozeForRouteParams>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const thread = useThreadShell({
    environmentId: EnvironmentId.make(route.params.environmentId),
    threadId: ThreadId.make(route.params.threadId),
  });
  const { snoozeThread } = useThreadListActions();
  const [value, setValue] = useState(() => resolveSnoozeForDefault(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleValueChange = useCallback((selected: Date) => {
    setValue(selected);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;

    const validationError = snoozeForTimeError(value, { now: new Date() });
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    if (thread === null) {
      Alert.alert(
        "Could not snooze thread",
        "This thread is no longer available. Return to the thread list and try again.",
      );
      return;
    }

    setIsSubmitting(true);
    const succeeded = await snoozeThread(thread, value.toISOString());
    if (succeeded) {
      navigation.goBack();
      return;
    }
    setIsSubmitting(false);
  }, [isSubmitting, navigation, snoozeThread, thread, value]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions
        options={{
          title: "Snooze until",
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
              <DateTimePicker
                display="compact"
                minimumDate={new Date()}
                mode="datetime"
                onValueChange={(_event, selected) => handleValueChange(selected)}
                style={{ alignSelf: "stretch" }}
                value={value}
              />
            ) : (
              <Text className="text-sm text-foreground-secondary">
                Custom snooze times are available on iOS.
              </Text>
            )}

            {error !== null ? (
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {error}
              </Text>
            ) : null}

            {Platform.OS === "ios" ? (
              <ConnectionSheetButton
                disabled={isSubmitting}
                icon="clock"
                label={isSubmitting ? "Snoozing..." : "Snooze thread"}
                onPress={() => {
                  void handleSubmit();
                }}
                tone="primary"
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
