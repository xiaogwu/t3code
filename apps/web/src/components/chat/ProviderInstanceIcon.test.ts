import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { LittleCoderIcon } from "../Icons";
import { providerClients } from "../settings/providerDriverMeta";
import {
  resolveInstanceIcon,
  resolveProviderInstanceAcpRegistryIconUrl,
} from "./ProviderInstanceIcon";

const ACP_REGISTRY = ProviderDriverKind.make("acpRegistry");

describe("resolveInstanceIcon", () => {
  it("lets a hosted instance's own icon win over the ACP Registry glyph", () => {
    expect(resolveInstanceIcon(ACP_REGISTRY, "littlecoder", "little-coder")).toEqual({
      Icon: LittleCoderIcon,
      packageIcon: undefined,
      overridden: true,
    });
    // Call sites without an instance id match on the display name.
    expect(resolveInstanceIcon(ACP_REGISTRY, undefined, "little-coder").overridden).toBe(true);
  });

  it("borrows another driver's package icon for a hosted instance", () => {
    const resolved = resolveInstanceIcon(ACP_REGISTRY, "pi", "pi");
    expect(resolved.overridden).toBe(true);
    expect(resolved.packageIcon).toBe(providerClients.get(ProviderDriverKind.make("pi"))?.icon);
  });

  it("leaves ordinary registry instances on the registry glyph", () => {
    expect(resolveInstanceIcon(ACP_REGISTRY, "kilo", "Kilo").overridden).toBe(false);
  });
});

describe("resolveProviderInstanceAcpRegistryIconUrl", () => {
  it("uses allowlisted catalog metadata and rejects untrusted overrides", () => {
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "kilo",
        iconUrl: "https://cdn.agentclientprotocol.com/registry/icons/kilo.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/icons/kilo.svg");
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "generic-agent",
        iconUrl: "https://example.com/not-official.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/generic-agent.svg");
  });
});
