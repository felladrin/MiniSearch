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
import {
  applyServerConfig,
  defaultSettings,
  hasStoredUserSettings,
  upgradeUntouchedSystemPrompt,
} from "@/modules/settings";
import { webGpuSupport } from "@/modules/webGpu";
import "@mantine/notifications/styles.css";
import { verifyStoredAccessKey } from "@/modules/accessKey";
import { getConfig, type ServerConfig } from "@/modules/config";
import MainPage from "../Pages/Main/MainPage";

const AccessPage = lazy(() => import("../Pages/AccessPage"));

/** The server config while it is being fetched, or after the fetch failed. */
type ConfigState = ServerConfig | "loading" | "unavailable";

function App() {
  const config = useServerConfig();
  useInitializeSettings(config);
  const { hasValidatedAccessKey, isCheckingStoredKey, setValidatedAccessKey } =
    useAccessKeyValidation(config);

  return (
    <MantineProvider defaultColorScheme="dark">
      {config === "unavailable" ? (
        <FullScreenMessage message="Could not load the server configuration. Please reload the page." />
      ) : isCheckingStoredKey ? (
        <FullScreenMessage message="Loading..." showLoader />
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

function FullScreenMessage({
  message,
  showLoader,
}: {
  message: string;
  showLoader?: boolean;
}) {
  return (
    <Container h="100vh">
      <Center h="100vh">
        <Stack align="center">
          {showLoader && <Loader />}
          <Text>{message}</Text>
        </Stack>
      </Center>
    </Container>
  );
}

export default App;

function useServerConfig(): ConfigState {
  const [config, setConfig] = useState<ConfigState>("loading");

  useEffect(() => {
    getConfig().then(setConfig, (error) => {
      addLogEntry(`Could not load the server configuration: ${error}`);
      setConfig("unavailable");
    });
  }, []);

  return config;
}

/**
 * Waits for the server config so its defaults can seed a fresh profile, and
 * for the WebGPU check, which picks between the GPU and the CPU default model.
 * When the config could not be loaded nothing is written: the app shows an
 * error instead, and settings seeded from shipped defaults would be taken for
 * the user's own choices on every later load.
 */
function useInitializeSettings(config: ConfigState) {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [settingsInitialized, setSettingsInitialized] = useState(false);
  const [hasWebGpu, setHasWebGpu] = useState<boolean>();

  useEffect(() => {
    webGpuSupport.then(setHasWebGpu);
  }, []);

  useEffect(() => {
    if (
      settingsInitialized ||
      config === "loading" ||
      config === "unavailable" ||
      hasWebGpu === undefined
    ) {
      return;
    }

    setSettings(
      applyServerConfig(
        upgradeUntouchedSystemPrompt({ ...defaultSettings, ...settings }),
        config,
        hasStoredUserSettings,
        hasWebGpu,
      ),
    );
    setSettingsInitialized(true);
    addLogEntry("Settings initialized");
  }, [config, settingsInitialized, settings, setSettings, hasWebGpu]);
}

/**
 * A custom React hook that validates the stored access key once the server
 * config is known.
 *
 * @remarks
 * Starts out unvalidated and stays that way while the config is missing, so an
 * unreachable server can never be mistaken for "access keys are disabled".
 */
function useAccessKeyValidation(config: ConfigState) {
  const [state, setState] = useState({
    hasValidatedAccessKey: false,
    isCheckingStoredKey: true,
  });

  useEffect(() => {
    if (config === "loading" || config === "unavailable") return;

    if (!config.accessKeysEnabled) {
      setState({ hasValidatedAccessKey: true, isCheckingStoredKey: false });
      return;
    }

    verifyStoredAccessKey(config.accessKeyTimeoutHours).then((isValid) =>
      setState({
        hasValidatedAccessKey: isValid,
        isCheckingStoredKey: false,
      }),
    );
  }, [config]);

  return {
    hasValidatedAccessKey: state.hasValidatedAccessKey,
    isCheckingStoredKey: state.isCheckingStoredKey,
    setValidatedAccessKey: (value: boolean) =>
      setState((prev) => ({ ...prev, hasValidatedAccessKey: value })),
  };
}
