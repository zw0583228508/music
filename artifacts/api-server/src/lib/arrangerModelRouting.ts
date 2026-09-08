/**
 * The one bit of state the router needs about YOUR_ARRANGER_MODEL (PR-31):
 * whether a version has been promoted. Kept in a module with no imports so
 * the provider registry, the model store and the routes can all read it
 * without a dependency cycle. The store registers the loader and refreshes
 * the flag at boot and on promote / retire.
 */
import type { ArrangerPolicyModel } from "@workspace/db";

export const ARRANGER_MODEL_PROVIDER_ID = "YOUR_ARRANGER_MODEL" as const;

export type ActiveArrangerModel = { id: string; version: number; model: ArrangerPolicyModel } | null;
export type ArrangerModelLoader = () => Promise<ActiveArrangerModel>;

let promoted = false;
let loader: ArrangerModelLoader = async () => null;

export function setArrangerModelPromoted(value: boolean): void {
  promoted = value;
}

export function arrangerModelIsPromoted(): boolean {
  return promoted;
}

export function registerArrangerModelLoader(next: ArrangerModelLoader): void {
  loader = next;
}

export function loadActiveArrangerModel(): Promise<ActiveArrangerModel> {
  return loader();
}
