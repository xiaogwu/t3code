/**
 * TitlePolicyReactor - Turn-triggered automatic title policy service.
 *
 * @module TitlePolicyReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface TitlePolicyReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class TitlePolicyReactor extends Context.Service<
  TitlePolicyReactor,
  TitlePolicyReactorShape
>()("t3/orchestration/Services/TitlePolicyReactor") {}
