import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { isBoundedString, isRecord } from "@originloom/react/lib/runtime-schema";

import type { RefreshResult } from "./refresh-result.js";

export type RefreshCoordinationCodec = {
  seal(result: RefreshResult): string;
  open(value: string | null): RefreshResult | null;
};

export function createRefreshCoordinationCodec(
  currentSecret: string,
  previousSecret?: string,
): RefreshCoordinationCodec {
  const keys = [currentSecret, previousSecret]
    .filter((value): value is string => Boolean(value))
    .map(deriveKey);

  return {
    seal(result) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keys[0]!, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(result), "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString("base64url"))
        .join(".");
    },
    open(value) {
      if (!value) return null;
      for (const key of keys) {
        const result = decrypt(value, key);
        if (result) return result;
      }
      return null;
    },
  };
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function decrypt(value: string, key: Buffer): RefreshResult | null {
  try {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return parseRefreshResult(JSON.parse(plaintext) as unknown);
  } catch {
    return null;
  }
}

function parseRefreshResult(value: unknown): RefreshResult | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "unauthorized") return { kind: "unauthorized" };
  if (
    value.kind === "success" &&
    isBoundedString(value.access, 16_384, 8) &&
    isBoundedString(value.refresh, 16_384, 8)
  ) {
    return { kind: "success", access: value.access, refresh: value.refresh };
  }
  return null;
}
