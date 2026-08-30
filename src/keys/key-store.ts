import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importJWK,
  importPKCS8,
  importSPKI,
  calculateJwkThumbprint,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import type { ResolvedConfig, SigningKey, SigningKeyStore } from "../core/types.js";

export class KeyStore implements SigningKeyStore {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    readonly keyId: string,
  ) {}

  static async create(config: ResolvedConfig["keys"]): Promise<KeyStore> {
    let privateKey: CryptoKey;
    let publicKey: CryptoKey;
    let source = config.privateKey;
    if (!source && config.privateKeyFile) {
      try {
        source = await readFile(config.privateKeyFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    if (source) {
      if (source.trim().startsWith("{")) {
        const jwk = JSON.parse(source) as JWK;
        privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
        const publicJwk = { ...jwk };
        delete publicJwk.d;
        publicKey = (await importJWK(publicJwk, "ES256")) as CryptoKey;
      } else {
        privateKey = await importPKCS8(source, "ES256");
        const { publicKey: derived } = await importPublicFromPrivate(source);
        publicKey = derived;
      }
    } else {
      const generated = await generateKeyPair("ES256", { extractable: true });
      privateKey = generated.privateKey;
      publicKey = generated.publicKey;
      if (config.privateKeyFile) {
        await mkdir(dirname(config.privateKeyFile), { recursive: true });
        await writeFile(config.privateKeyFile, await exportPKCS8(privateKey), { mode: 0o600 });
        await chmod(config.privateKeyFile, 0o600);
      }
    }

    const publicJwk = await exportJWK(publicKey);
    const keyId = config.kid ?? (await calculateJwkThumbprint(publicJwk));
    return new KeyStore(privateKey, publicKey, keyId);
  }

  async current(): Promise<SigningKey> {
    return {
      keyId: this.keyId,
      algorithm: "ES256",
      sign: async (payload, header = {}) =>
        new SignJWT(payload)
          .setProtectedHeader({ alg: "ES256", kid: this.keyId, ...header })
          .sign(this.privateKey),
    };
  }

  async publicJwks(): Promise<{ keys: JWK[] }> {
    return {
      keys: [{ ...(await exportJWK(this.publicKey)), kid: this.keyId, alg: "ES256", use: "sig" }],
    };
  }

  async publicPem(keyId: string): Promise<string | undefined> {
    return keyId === this.keyId ? exportSPKI(this.publicKey) : undefined;
  }

  async etag(): Promise<string> {
    return `"${createHash("sha256")
      .update(JSON.stringify(await this.publicJwks()))
      .digest("base64url")}"`;
  }
}

async function importPublicFromPrivate(pem: string): Promise<{ publicKey: CryptoKey }> {
  const { createPrivateKey, createPublicKey } = await import("node:crypto");
  const publicPem = createPublicKey(createPrivateKey(pem))
    .export({ type: "spki", format: "pem" })
    .toString();
  return { publicKey: await importSPKI(publicPem, "ES256") };
}
