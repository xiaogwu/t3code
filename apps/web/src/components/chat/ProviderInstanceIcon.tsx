import { type CSSProperties, memo } from "react";
import { type ProviderDriverKind } from "@t3tools/contracts";

import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";
import { LittleCoderIcon, PiAgentIcon, type Icon } from "../Icons";
import { cn } from "~/lib/utils";

// An instance can ride a driver that is not its own agent: `pi` and `little-coder`
// are both hosted on the generic gemini ACP driver, so the driver icon would show
// Gemini. Drop this once the native piAgent driver ships and the instance can use
// its own kind. Keyed on the instance id and on the display name, because some
// call sites only have the latter.
const ICON_BY_INSTANCE: Record<string, Icon> = {
  pi: PiAgentIcon,
  littlecoder: LittleCoderIcon,
  "little-coder": LittleCoderIcon,
};

function resolveInstanceIcon(
  driverKind: ProviderDriverKind,
  instanceId: string | undefined,
  displayName: string,
): Icon | null {
  // Call sites without an instance id fall back to the display name, which for
  // a hosted instance is the agent's own name.
  const key = (instanceId ?? displayName).trim().toLowerCase();
  return ICON_BY_INSTANCE[key] ?? PROVIDER_ICON_BY_PROVIDER[driverKind] ?? null;
}

export function providerInstanceInitials(label: string): string {
  const words = label.replace(/[_-]+/g, " ").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export const ProviderInstanceIcon = memo(function ProviderInstanceIcon(props: {
  driverKind: ProviderDriverKind;
  displayName: string;
  instanceId?: string | undefined;
  accentColor?: string | undefined;
  showBadge?: boolean;
  badgeContent?: "initials" | "none";
  className?: string;
  iconClassName?: string;
  badgeClassName?: string;
  statusDotClassName?: string;
  indicatorBackground?: string;
}) {
  const Icon = resolveInstanceIcon(props.driverKind, props.instanceId, props.displayName);
  const indicatorBackground = props.indicatorBackground ?? "var(--card)";
  const accentStyle = props.accentColor
    ? ({ "--provider-accent": props.accentColor } as CSSProperties)
    : undefined;
  const badgeContent = props.badgeContent ?? "initials";

  return (
    <span
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center overflow-visible",
        props.className,
      )}
      style={accentStyle}
      data-provider-accent-color={props.accentColor}
    >
      {Icon ? (
        <Icon className={cn("size-5 shrink-0", props.iconClassName)} aria-hidden />
      ) : (
        <span className={cn("text-[10px] font-semibold leading-none", props.iconClassName)}>
          {providerInstanceInitials(props.displayName)}
        </span>
      )}
      {props.statusDotClassName ? (
        <span
          className={cn(
            "pointer-events-none absolute -left-0.5 -top-0.5 z-10 size-2 rounded-full",
            props.statusDotClassName,
          )}
          style={{ boxShadow: `0 0 0 2px ${indicatorBackground}` }}
          aria-hidden
        />
      ) : null}
      {props.showBadge ? (
        <span
          className={cn(
            "pointer-events-none absolute right-0 bottom-0 z-10 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-0.5 text-[8px] font-semibold leading-none shadow-sm",
            props.accentColor
              ? "bg-[var(--provider-accent)] text-white"
              : "bg-muted text-muted-foreground",
            props.badgeClassName,
          )}
          style={{ borderColor: indicatorBackground }}
          aria-hidden
        >
          {badgeContent === "initials" ? providerInstanceInitials(props.displayName) : null}
        </span>
      ) : null}
    </span>
  );
});
