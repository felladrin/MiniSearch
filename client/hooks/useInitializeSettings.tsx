import { useEffect } from "react";
import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../modules/pubSub";
import { defaultSettings } from "../modules/settings";

/**
 * A custom React hook that initializes the application settings.
 *
 * @returns The initialized settings object.
 *
 * @remarks
 * This hook uses the `usePubSub` hook to access and update the settings state.
 * It initializes the settings by merging the default settings with any existing settings.
 * The initialization is performed once when the component mounts.
 *
 * @example
 * ```
 * const App = () => {
 *   const settings = useInitializeSettings();
 *   // Use settings in your component
 *   return <div>{settings.someSetting}</div>;
 * };
 * ```
 */
export function useInitializeSettings() {
  const [settings, setSettings] = usePubSub(settingsPubSub);

  useEffect(() => setSettings({ ...defaultSettings, ...settings }), []);

  return settings;
}
