// =============================================================================
// Shared — Capability Definition Helper
// =============================================================================
// Typed capability annotation for use cases.
// Every use case file MUST export a `capability` using this function.
// The generator script reads these to produce capabilities.yml.
// =============================================================================

export type CapabilityDefinition = {
  name: string;
  description?: string;
  useCase: string;
  preconditions: string[];
  effects: string[];
  context?: Record<string, string>;
  query?: boolean; // true for pure queries (no state change) — generator skips these
};

export function defineCapability(def: CapabilityDefinition): CapabilityDefinition {
  return def;
}
