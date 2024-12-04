import { MantineProvider } from "@mantine/core";
import { Route, Switch } from "wouter";
import "@mantine/core/styles.css";
import { Notifications } from "@mantine/notifications";
import { usePubSub } from "create-pubsub/react";
import { lazy, useEffect, useState } from "react";
import { addLogEntry } from "../../modules/logEntries";
import { settingsPubSub } from "../../modules/pubSub";
import { defaultSettings } from "../../modules/settings";
import "@mantine/notifications/styles.css";
import { verifyStoredAccessKey } from "../../modules/accessKey";

const MainPage = lazy(() => import("../Pages/Main/MainPage"));
const AccessPage = lazy(() => import("../Pages/AccessPage"));

export function App() {
  useInitializeSettings();
  const { hasValidatedAccessKey, isCheckingStoredKey, setValidatedAccessKey } =
    useAccessKeyValidation();

  if (isCheckingStoredKey) {
    return null;
  }

  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications />
      <Switch>
        <Route path="/">
          {VITE_ACCESS_KEYS_ENABLED && !hasValidatedAccessKey ? (
            <AccessPage onAccessKeyValid={() => setValidatedAccessKey(true)} />
          ) : (
            <MainPage />
          )}
        </Route>
      </Switch>
    </MantineProvider>
  );
}

/**
 * A custom React hook that initializes the application settings.
 *
 * @returns The initialized settings object.
 *
 * @remarks
 * This hook uses the `usePubSub` hook to access and update the settings state.
 * It initializes the settings by merging the default settings with any existing settings.
 * The initialization is performed once when the component mounts.
 */
function useInitializeSettings() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [settingsInitialized, setSettingsInitialized] = useState(false);

  useEffect(() => {
    if (settingsInitialized) return;

    setSettings({ ...defaultSettings, ...settings });

    setSettingsInitialized(true);

    addLogEntry("Settings initialized");
  }, [settings, setSettings, settingsInitialized]);

  return settings;
}

/**
 * A custom React hook that validates the stored access key on mount.
 *
 * @returns An object containing the validation state and loading state
 */
function useAccessKeyValidation() {
  const [hasValidatedAccessKey, setValidatedAccessKey] = useState(false);
  const [isCheckingStoredKey, setCheckingStoredKey] = useState(true);

  useEffect(() => {
    async function checkStoredAccessKey() {
      if (VITE_ACCESS_KEYS_ENABLED) {
        const isValid = await verifyStoredAccessKey();
        if (isValid) setValidatedAccessKey(true);
      }
      setCheckingStoredKey(false);
    }

    checkStoredAccessKey();
  }, []);

  return {
    hasValidatedAccessKey,
    isCheckingStoredKey,
    setValidatedAccessKey,
  };
}
