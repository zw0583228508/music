/**
 * Wave U — Universal Producer Intelligence (PR-U1): the contracts and the pure,
 * deterministic modules behind them, plus PR-U3's style research agent (the
 * one module here that may call a model — only when configured, and only for
 * conventions in the fixed vocabulary). See docs/master-plan.md § Wave U.
 */
export * from "./vocabulary";
export * from "./intentExtraction";
export * from "./styleResolution";
export * from "./styleResearch";
export * from "./clarification";
export * from "./briefCompiler";
export * from "./briefToPlanner";
export * from "./conceptGenerator";
export * from "./editPlan";
export * from "./explain";
