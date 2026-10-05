import { type CSSProperties, memo } from "react";

import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";

import { ProviderDriverKind } from "@t3tools/contracts";
import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  Gemini,
  GrokIcon,
  Icon,
  LittleCoderIcon,
  OpenAI,
  OpenCodeIcon,
  PiAgentIcon,
} from "../Icons";

import { cn } from "~/lib/utils";
import {
  AcpRegistryAgentIcon,
  officialAcpRegistryIconUrlForAgentId,
  resolveOfficialAcpRegistryIconUrl,
} from "../settings/AcpRegistryIcon";

const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
  [ProviderDriverKind.make("opencode")]: OpenCodeIcon,
  [ProviderDriverKind.make("cursor")]: CursorIcon,
  [ProviderDriverKind.make("grok")]: GrokIcon,
  [ProviderDriverKind.make("gemini")]: Gemini,
  [ProviderDriverKind.make("antigravity")]: AntigravityIcon,
  [ProviderDriverKind.make("pi")]: PiAgentIcon,
};

const PROVIDER_TEXT_COLOR_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("codex")]: "text-black dark:text-white",
  [ProviderDriverKind.make("claudeAgent")]: "text-[#d97757]",
  [ProviderDriverKind.make("cursor")]: "text-[#26251E] dark:text-[#EDECEC]",
  [ProviderDriverKind.make("grok")]: "text-[#0F0F0F] dark:text-[#F5F5F5]",
  [ProviderDriverKind.make("pi")]: "text-[#0F0F0F] dark:text-[#F5F5F5]",
  [ProviderDriverKind.make("opencode")]: "text-[#211E1E] dark:text-[#F1ECEC]",
  [ProviderDriverKind.make("antigravity")]: "text-[#5b87bf]",
};

export function providerTextColorClassName(driverKind: ProviderDriverKind): string | undefined {
  return PROVIDER_TEXT_COLOR_BY_PROVIDER[driverKind];
}

export function resolveProviderInstanceAcpRegistryIconUrl(input: {
  readonly driverKind: ProviderDriverKind;
  readonly agentId?: string | undefined;
  readonly iconUrl?: string | undefined;
}): string | null {
  if (input.driverKind !== "acpRegistry") return null;
  return (
    resolveOfficialAcpRegistryIconUrl(input.iconUrl ?? null) ??
    officialAcpRegistryIconUrlForAgentId(input.agentId?.trim() || null)
  );
}

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

export const ProviderInstanceIcon = memo(function ProviderInstanceIcon(props: {
  driverKind: ProviderDriverKind;
  displayName: string;
  instanceId?: string | undefined;
  accentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
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
  const isAcpRegistry = props.driverKind === "acpRegistry";
  const acpRegistryIconUrl = resolveProviderInstanceAcpRegistryIconUrl({
    driverKind: props.driverKind,
    agentId: props.acpRegistryAgentId,
    iconUrl: props.acpRegistryIconUrl,
  });

  return (
    <span
      className={cn(
        "relative isolate z-30 inline-flex shrink-0 items-center justify-center overflow-visible",
        props.className,
      )}
      style={accentStyle}
      data-provider-accent-color={props.accentColor}
    >
      {isAcpRegistry ? (
        <AcpRegistryAgentIcon
          // The search-tile radius would crop most of the glyph at these
          // inline sizes.
          className={cn("size-5 rounded-none bg-transparent", props.iconClassName)}
          fallbackClassName="size-full"
          icon={acpRegistryIconUrl}
        />
      ) : Icon ? (
        <Icon className={cn("size-5 shrink-0", props.iconClassName)} aria-hidden />
      ) : (
        <span className={cn("text-3xs font-semibold leading-none", props.iconClassName)}>
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
            "pointer-events-none absolute right-0 bottom-0 z-10 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-0.5 text-4xs font-semibold leading-none shadow-sm",
            props.accentColor
              ? "bg-(--provider-accent) text-white"
              : "bg-card text-muted-foreground",
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
