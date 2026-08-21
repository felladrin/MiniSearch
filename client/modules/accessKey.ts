import { notifications } from "@mantine/notifications";
import { argon2id } from "hash-wasm";
import { addLogEntry } from "./logEntries";

const ACCESS_KEY_STORAGE_KEY = "accessKeyHash";

interface StoredAccessKey {
  hash: string;
  timestamp: number;
}

async function hashAccessKey(accessKey: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  return argon2id({
    password: accessKey,
    salt,
    parallelism: 1,
    iterations: 16,
    memorySize: 512,
    // The digest is what a caller without the key would have to guess to pass
    // validation, so it sets the ceiling on forgery resistance.
    hashLength: 32,
    outputType: "encoded",
  });
}

/**
 * Validates the key against the server; on success the hash is stored locally
 * so later loads can go through `verifyStoredAccessKey`.
 */
export type AccessKeyResult = "valid" | "invalid" | "rateLimited";

export async function validateAccessKey(
  accessKey: string,
): Promise<AccessKeyResult> {
  try {
    const hash = await hashAccessKey(accessKey);
    const response = await fetch("/api/validate-access-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKeyHash: hash }),
    });

    // A 429 is "try again in a moment", not "wrong key": keep the two apart so
    // the caller can show a refusal message instead of a wrong-key error.
    if (response.status === 429) {
      addLogEntry("Access key validation rate-limited");
      notifications.show({
        title: "Too many attempts",
        message: "Please wait a few seconds and try again",
        color: "yellow",
        position: "top-right",
      });
      return "rateLimited";
    }

    const data = await response.json();

    if (data.valid) {
      const storedData: StoredAccessKey = {
        hash,
        timestamp: Date.now(),
      };
      localStorage.setItem(ACCESS_KEY_STORAGE_KEY, JSON.stringify(storedData));
      addLogEntry("Access key hash stored");
      return "valid";
    }

    return "invalid";
  } catch (error) {
    addLogEntry(`Error validating access key: ${error}`);
    notifications.show({
      title: "Error validating access key",
      message: "Please contact the administrator",
      color: "red",
      position: "top-right",
    });
    return "invalid";
  }
}

/**
 * Re-validates the stored hash, still usable for `timeoutHours` since it was
 * first validated; 0 means every load asks for the key again.
 */
export async function verifyStoredAccessKey(
  timeoutHours: number,
): Promise<boolean> {
  if (timeoutHours === 0) return false;

  const storedData = localStorage.getItem(ACCESS_KEY_STORAGE_KEY);
  if (!storedData) return false;

  try {
    const { hash, timestamp }: StoredAccessKey = JSON.parse(storedData);

    const expirationTime = timeoutHours * 60 * 60 * 1000;
    if (Date.now() - timestamp > expirationTime) {
      localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
      addLogEntry("Stored access key expired");
      return false;
    }

    const response = await fetch("/api/validate-access-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKeyHash: hash }),
    });

    // A 429 must not be read as "wrong key": the stored hash may be fine and
    // the caller simply hit the rate limiter. Keep the hash on disk so a
    // later load can still validate it.
    if (response.status === 429) {
      addLogEntry("Stored access key validation rate-limited");
      return false;
    }

    const data = await response.json();
    if (!data.valid) {
      localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
      addLogEntry("Stored access key is no longer valid");
      return false;
    }

    addLogEntry("Using stored access key");
    return true;
  } catch (error) {
    addLogEntry(`Error verifying stored access key: ${error}`);
    localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
    return false;
  }
}
