import { useForm } from "@mantine/form";
import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "@/modules/pubSub";
import type { defaultSettings } from "@/modules/settings";

type Settings = typeof defaultSettings;

function pick<T, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = source[key];
  return picked;
}

/**
 * A form over the settings in `keys`. Each change writes only the keys that
 * changed, merged into the settings as they are at that moment, so a form that
 * has been open for a while cannot put back a value another writer changed.
 */
export function useSettingsForm<K extends keyof Settings>(keys: readonly K[]) {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [, , getSettings] = settingsPubSub;

  return useForm<Pick<Settings, K>>({
    initialValues: pick(settings, keys),
    onValuesChange: (values, previous) => {
      const changed = keys.filter((key) => values[key] !== previous[key]);
      if (changed.length === 0) return;

      setSettings({ ...getSettings(), ...pick(values, changed) });
    },
  });
}
