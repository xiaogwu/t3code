import { type AgySettings, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

const TIMEOUT_MS = 180_000;
const OutputEnvelope = Schema.Struct({ structured_output: Schema.Unknown });
const decodeEnvelope = Schema.decodeEffect(Schema.fromJsonString(OutputEnvelope));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isTextGenerationError = Schema.is(TextGenerationError);

type Operation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

export const makeAgyTextGeneration = Effect.fn("makeAgyTextGeneration")(function* (
  settings: AgySettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const runJson = Effect.fn("runAgyJson")(function* <S extends Schema.Top>(input: {
    readonly operation: Operation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly model: string;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const jsonSchema = yield* encodeJson(toJsonSchemaObject(input.outputSchema)).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Failed to encode structured output schema.",
            cause,
          }),
      ),
    );
    const commandPath = settings.binaryPath || "agy";
    const spawnCommand = yield* resolveSpawnCommand(
      commandPath,
      [
        "--print",
        input.prompt,
        "--output-format",
        "json",
        "--json-schema",
        jsonSchema,
        "--model",
        input.model,
        ...tokenizeCliArgs(settings.launchArgs),
      ],
      { env: environment },
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Failed to resolve the Antigravity CLI command.",
            cause,
          }),
      ),
    );
    const output = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner
          .spawn(
            ChildProcess.make(spawnCommand.command, spawnCommand.args, {
              cwd: input.cwd,
              env: environment,
              extendEnv: true,
              shell: spawnCommand.shell,
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation: input.operation,
                  detail: "Failed to spawn the Antigravity CLI.",
                  cause,
                }),
            ),
          );
        const collect = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
          stream.pipe(
            Stream.decodeText(),
            Stream.runFold(
              () => "",
              (acc, chunk) => acc + chunk,
            ),
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation: input.operation,
                  detail: "Failed to read Antigravity CLI output.",
                  cause,
                }),
            ),
          );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [collect(child.stdout), collect(child.stderr), child.exitCode],
          { concurrency: "unbounded" },
        );
        if (Number(exitCode) !== 0) {
          return yield* new TextGenerationError({
            operation: input.operation,
            detail:
              stderr.trim() || stdout.trim() || `Antigravity CLI exited with code ${exitCode}.`,
          });
        }
        return stdout;
      }),
    ).pipe(
      Effect.timeoutOption(TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: "Antigravity CLI request timed out.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: "Antigravity CLI request failed.",
              cause,
            }),
      ),
    );
    const envelope = yield* decodeEnvelope(output).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Antigravity CLI returned an unexpected output format.",
            cause,
          }),
      ),
    );
    return yield* Schema.decodeEffect(input.outputSchema)(envelope.structured_output).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Antigravity returned invalid structured output.",
            cause,
          }),
      ),
    );
  });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("AgyTextGeneration.generateCommitMessage")(function* (input) {
      const built = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        model: input.modelSelection.model,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("AgyTextGeneration.generatePrContent")(function* (input) {
      const built = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        model: input.modelSelection.model,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("AgyTextGeneration.generateBranchName")(function* (input) {
      const built = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        model: input.modelSelection.model,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("AgyTextGeneration.generateThreadTitle")(function* (input) {
      const built = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        model: input.modelSelection.model,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
