import { addLogEntry } from "./logEntries";
import { notifications } from "@mantine/notifications";

export async function validateAccessKey(accessKey: string) {
  try {
    const response = await fetch("/api/validate-access-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey }),
    });
    const data = await response.json();
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
