import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Known native terminal applications. `automatic` selects a host-appropriate fallback. */
export const EXTERNAL_TERMINALS = [
  { id: "automatic", label: "Automatic" },
  { id: "terminal", label: "Terminal.app" },
  { id: "iterm2", label: "iTerm2" },
  { id: "windows-terminal", label: "Windows Terminal" },
  { id: "powershell", label: "PowerShell" },
  { id: "gnome-terminal", label: "GNOME Terminal" },
  { id: "konsole", label: "Konsole" },
  { id: "alacritty", label: "Alacritty" },
  { id: "kitty", label: "Kitty" },
  { id: "wezterm", label: "WezTerm" },
] as const;

export const ExternalTerminalId = Schema.Literals(EXTERNAL_TERMINALS.map(({ id }) => id));
export type ExternalTerminalId = typeof ExternalTerminalId.Type;

export const LaunchExternalTerminalInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  terminal: ExternalTerminalId,
});
export type LaunchExternalTerminalInput = typeof LaunchExternalTerminalInput.Type;

export class ExternalTerminalCwdNotFoundError extends Schema.TaggedErrorClass<ExternalTerminalCwdNotFoundError>()(
  "ExternalTerminalCwdNotFoundError",
  { cwd: Schema.String },
) {
  override get message(): string {
    return `External terminal working directory was not found: ${this.cwd}`;
  }
}

export class ExternalTerminalCwdNotDirectoryError extends Schema.TaggedErrorClass<ExternalTerminalCwdNotDirectoryError>()(
  "ExternalTerminalCwdNotDirectoryError",
  { cwd: Schema.String },
) {
  override get message(): string {
    return `External terminal working directory is not a directory: ${this.cwd}`;
  }
}

export class ExternalTerminalCwdStatError extends Schema.TaggedErrorClass<ExternalTerminalCwdStatError>()(
  "ExternalTerminalCwdStatError",
  { cwd: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Unable to inspect external terminal working directory: ${this.cwd}`;
  }
}

export class ExternalTerminalUnsupportedError extends Schema.TaggedErrorClass<ExternalTerminalUnsupportedError>()(
  "ExternalTerminalUnsupportedError",
  { terminal: ExternalTerminalId },
) {
  override get message(): string {
    return `External terminal '${this.terminal}' is not supported on this host.`;
  }
}

export class ExternalTerminalCommandNotFoundError extends Schema.TaggedErrorClass<ExternalTerminalCommandNotFoundError>()(
  "ExternalTerminalCommandNotFoundError",
  { terminal: ExternalTerminalId, command: Schema.String },
) {
  override get message(): string {
    return `External terminal command not found: ${this.command}`;
  }
}

const ExternalTerminalSpawnFields = {
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cause: Schema.Defect(),
};

export class ExternalTerminalSpawnError extends Schema.TaggedErrorClass<ExternalTerminalSpawnError>()(
  "ExternalTerminalSpawnError",
  { ...ExternalTerminalSpawnFields, cwd: Schema.String, terminal: ExternalTerminalId },
) {
  override get message(): string {
    return `Failed to open '${this.cwd}' in external terminal '${this.terminal}'.`;
  }
}

export const ExternalTerminalError = Schema.Union([
  ExternalTerminalCwdNotFoundError,
  ExternalTerminalCwdNotDirectoryError,
  ExternalTerminalCwdStatError,
  ExternalTerminalUnsupportedError,
  ExternalTerminalCommandNotFoundError,
  ExternalTerminalSpawnError,
]);
export type ExternalTerminalError = typeof ExternalTerminalError.Type;
