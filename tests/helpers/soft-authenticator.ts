import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

/**
 * Yazılım WebAuthn kimlik doğrulayıcısı (yalnızca testler): ES256 (P-256) anahtar çifti,
 * "none" attestation ile kayıt yanıtı ve imzalı giriş (assertion) yanıtı üretir. Böylece
 * passkey akışı tarayıcı olmadan, `@simplewebauthn/server` doğrulamasının gerçek koduyla
 * uçtan uca test edilir.
 */

const b64url = (buf: Uint8Array | Buffer) => Buffer.from(buf).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly cosePublicKey: Uint8Array;
  signCount = 0;

  constructor(
    private readonly rpId = "localhost",
    private readonly origin = "http://localhost:3000"
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]);
    this.cosePublicKey = isoCBOR.encode(cose);
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
      "utf8"
    );
  }

  /** `navigator.credentials.create()` yanıtının JSON karşılığı. */
  register(options: { challenge: string }) {
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]), // UP | UV | AT
      u32(this.signCount),
      Buffer.alloc(16), // AAGUID
      idLen,
      this.credentialId,
      Buffer.from(this.cosePublicKey),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]) as never
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  /** `navigator.credentials.get()` yanıtının JSON karşılığı (sayaç her çağrıda artar). */
  authenticate(options: { challenge: string }, userId: string) {
    this.signCount += 1;
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([0x05]), u32(this.signCount)]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), {
      key: this.privateKey,
      dsaEncoding: "der",
    });
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: b64url(Buffer.from(userId, "utf8")),
      },
      clientExtensionResults: {},
    };
  }
}
