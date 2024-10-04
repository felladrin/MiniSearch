import { Route, Switch } from "wouter";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { lazy, useEffect, useState } from "react";
import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../modules/pubSub";
import { defaultSettings } from "../../modules/settings";
import { addLogEntry } from "../../modules/logEntries";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { match } from "ts-pattern";

const MainPage = lazy(() => import("../Pages/Main/MainPage"));
const AccessPage = lazy(() => import("../Pages/AccessPage"));

export function App() {
  useInitializeSettings();

  const [hasValidatedAccessKey, setValidatedAccessKey] = useState(false);

  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications />
      <Switch>
        <Route path="/">
          {match([VITE_ACCESS_KEYS_ENABLED, hasValidatedAccessKey])
            .with([true, false], () => (
              <AccessPage
                onAccessKeyValid={() => setValidatedAccessKey(true)}
              />
            ))
            .otherwise(() => (
              <MainPage />
            ))}
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

  useEffect(() => {
    setSettings({ ...defaultSettings, ...settings });
    addLogEntry("Settings initialized");
  }, []);

  return settings;
}
