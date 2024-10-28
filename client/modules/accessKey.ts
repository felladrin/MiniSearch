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
    hashLength: 8,
    outputType: "encoded",
  });
}

export async function validateAccessKey(accessKey: string): Promise<boolean> {
  try {
    const hash = await hashAccessKey(accessKey);
    const response = await fetch("/api/validate-access-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKeyHash: hash }),
    });
    const data = await response.json();

    if (data.valid) {
      const storedData: StoredAccessKey = {
        hash,
        timestamp: Date.now(),
      };
      localStorage.setItem(ACCESS_KEY_STORAGE_KEY, JSON.stringify(storedData));
      addLogEntry("Access key hash stored");
    }

    return data.valid;
  } catch (error) {
    addLogEntry(`Error validating access key: ${error}`);
    notifications.show({
      title: "Error validating access key",
      message: "Please contact the administrator",
      color: "red",
      position: "top-right",
    });
    return false;
  }
}

export async function verifyStoredAccessKey(): Promise<boolean> {
  if (VITE_ACCESS_KEY_TIMEOUT_HOURS === 0) return false;

  const storedData = localStorage.getItem(ACCESS_KEY_STORAGE_KEY);
  if (!storedData) return false;

  try {
    const { hash, timestamp }: StoredAccessKey = JSON.parse(storedData);

    const expirationTime = VITE_ACCESS_KEY_TIMEOUT_HOURS * 60 * 60 * 1000;
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
