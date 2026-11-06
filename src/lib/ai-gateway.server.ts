// Compatibility export for old imports; all traffic uses the independently configured provider.
import { administrativeModel } from "./administrative-ai.server";
export function createLovableAiGatewayProvider(_legacyKey?: string) {
  return (_legacyModel?: string) => administrativeModel();
}
