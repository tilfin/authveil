import { resolveConfig } from "./config/index.js";
import { AuthVeilServer } from "./server/index.js";
import type { AuthVeil, AuthVeilOptions, ResolvedConfig } from "./core/types.js";

export async function createAuthVeil(options: AuthVeilOptions | ResolvedConfig): Promise<AuthVeil> {
  return AuthVeilServer.create(resolveConfig(options));
}
export {
  ConfigError,
  duration,
  expandEnvironment,
  findConfig,
  loadConfig,
  resolveConfig,
} from "./config/index.js";
export { createIdentityProxyAdapter, BUILTIN_RESERVED_HEADERS } from "./proxy/adapters.js";
export { identityFromMock, validateIdentity } from "./identity/identity.js";
export { KeyStore } from "./keys/key-store.js";
export { SecretString, SessionStore } from "./identity/session.js";
export type * from "./core/types.js";
