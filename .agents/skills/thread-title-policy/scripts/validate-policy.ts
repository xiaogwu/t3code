// Run: bun run .agents/skills/thread-title-policy/scripts/validate-policy.ts <policy.json>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { TitlePolicy } from "../../../../packages/contracts/src/titlePolicy.ts";

const requireFromContracts = createRequire(
  new URL("../../../../packages/contracts/package.json", import.meta.url),
);
const Schema = requireFromContracts("effect/Schema") as typeof import("effect/Schema");

const path = process.argv[2];
if (!path) {
  console.error("Usage: validate-policy.ts <policy.json>");
  process.exit(1);
}

const decoded = Schema.decodeUnknownResult(TitlePolicy)(JSON.parse(readFileSync(path, "utf8")));
if (decoded._tag === "Failure") {
  console.error("Policy failed schema validation:");
  console.error(decoded.failure.message);
  process.exit(1);
}

const policy = decoded.success;
console.log(`Schema OK. ${policy.rules.length} rule(s), ${policy.examples.length} example(s).`);

if (policy.examples.length === 0) {
  console.warn("Warning: no examples. The settings preview will have nothing to validate.");
}

for (const rule of policy.rules) {
  if (rule.when.urlKind === undefined && rule.when.urlMatches === undefined) {
    console.error(`Rule "${rule.name}" has no urlKind or urlMatches and can never match.`);
    process.exit(1);
  }
}

console.log("Policy looks structurally sound. Paste it into Settings -> Thread title policy.");
