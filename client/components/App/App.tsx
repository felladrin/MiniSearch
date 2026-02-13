import {
  Center,
  Container,
  Loader,
  MantineProvider,
  Stack,
  Text,
} from "@mantine/core";
import { Route, Switch } from "wouter";
import "@mantine/core/styles.css";
import { Notifications } from "@mantine/notifications";
import { usePubSub } from "create-pubsub/react";
import { lazy, useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import { settingsPubSub } from "@/modules/pubSub";
import { defaultSettings } from "@/modules/settings";
import "@mantine/notifications/styles.css";
import { verifyStoredAccessKey } from "@/modules/accessKey";
import MainPage from "../Pages/Main/MainPage";

const AccessPage = lazy(() => import("../Pages/AccessPage"));

/**
 * Main application component with access key validation and routing
 */
function App() {
  useInitializeSettings();
  const { hasValidatedAccessKey, isCheckingStoredKey, setValidatedAccessKey } =
    useAccessKeyValidation();

  return (
    <MantineProvider defaultColorScheme="dark">
      {isCheckingStoredKey ? (
        <Container h="100vh">
          <Center h="100vh">
            <Stack align="center">
              <Loader />
              <Text>Verifying access...</Text>
            </Stack>
          </Center>
        </Container>
      ) : (
        <>
          <Notifications />
          <Switch>
            <Route path="/">
              {hasValidatedAccessKey ? (
                <MainPage />
              ) : (
                <AccessPage
                  onAccessKeyValid={() => setValidatedAccessKey(true)}
                />
              )}
            </Route>
          </Switch>
        </>
      )}
    </MantineProvider>
  );
}

export default App;

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
  const [state, setState] = useState({
    settingsInitialized: false,
  });

  useEffect(() => {
    if (state.settingsInitialized) return;

    setSettings({ ...defaultSettings, ...settings });

    setState({ settingsInitialized: true });

    addLogEntry("Settings initialized");
  }, [settings, setSettings, state.settingsInitialized]);

  return settings;
}

/**
 * A custom React hook that validates the stored access key on mount.
 *
 * @returns An object containing the validation state and loading state
 */
function useAccessKeyValidation() {
  const [state, setState] = useState(() => ({
    hasValidatedAccessKey: !VITE_ACCESS_KEYS_ENABLED,
    isCheckingStoredKey: VITE_ACCESS_KEYS_ENABLED,
  }));

  useEffect(() => {
    if (!VITE_ACCESS_KEYS_ENABLED) return;

    async function checkStoredAccessKey() {
      const isValid = await verifyStoredAccessKey();
      if (isValid)
        setState((prev) => ({ ...prev, hasValidatedAccessKey: true }));
      setState((prev) => ({ ...prev, isCheckingStoredKey: false }));
    }

    checkStoredAccessKey();
  }, []);

  return {
    hasValidatedAccessKey: state.hasValidatedAccessKey,
    isCheckingStoredKey: state.isCheckingStoredKey,
    setValidatedAccessKey: (value: boolean) =>
      setState((prev) => ({ ...prev, hasValidatedAccessKey: value })),
  };
}
