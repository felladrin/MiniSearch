import { Select, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import getUnicodeFlagIcon from "country-flag-icons/unicode";
import { usePubSub } from "create-pubsub/react";
import { useCallback, useEffect, useState } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import { listVoices, type VoiceOption } from "@/modules/textToSpeech";

interface VoiceGroup {
  group: string;
  items: { value: string; label: string }[];
}

export default function VoiceSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [voiceGroups, setVoiceGroups] = useState<VoiceGroup[]>([]);

  const getCountryFlag = useCallback((langCode: string) => {
    try {
      const country = langCode.replace("_", "-").split("-")[1];

      if (country?.length !== 2) throw new Error("Invalid country code");

      return getUnicodeFlagIcon(country);
    } catch {
      return "🌐";
    }
  }, []);

  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  useEffect(() => {
    let cancelled = false;

    const toGroups = (options: VoiceOption[]): VoiceGroup[] => {
      const byEngine: Record<string, { value: string; label: string }[]> = {
        "Local voices": [],
        "System voices": [],
      };

      for (const option of options) {
        const group =
          option.engine === "local" ? "Local voices" : "System voices";
        byEngine[group].push({
          value: option.value,
          label: `${getCountryFlag(option.languageCode)} ${option.label}`,
        });
      }

      return Object.entries(byEngine)
        .filter(([, items]) => items.length > 0)
        .map(([group, items]) => ({ group, items }));
    };

    const updateVoices = () => {
      listVoices(undefined, settings.textToSpeechEngine).then((options) => {
        if (!cancelled) setVoiceGroups(toGroups(options));
      });
    };

    updateVoices();

    // Absent on the platforms this feature exists for, so it cannot be assumed.
    if (self.speechSynthesis)
      self.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      cancelled = true;
      if (self.speechSynthesis) self.speechSynthesis.onvoiceschanged = null;
    };
  }, [getCountryFlag, settings.textToSpeechEngine]);

  return (
    <Stack gap="xs">
      <Text size="sm">Speech Engine</Text>
      <Text size="xs" c="dimmed">
        The local engine downloads a small neural voice on the first use and
        sounds the same on every platform. The system engine uses the voices
        your operating system provides.
      </Text>
      <Select
        {...form.getInputProps("textToSpeechEngine")}
        data={[
          { value: "local", label: "Local neural voice" },
          { value: "system", label: "System voices" },
        ]}
        allowDeselect={false}
      />
      <Text size="sm">Voice Selection</Text>
      <Text size="xs" c="dimmed">
        Choose the voice to use when reading AI responses aloud. Leave it empty
        to pick one automatically for your language.
      </Text>
      <Select
        {...form.getInputProps("selectedVoiceId")}
        data={voiceGroups}
        searchable
        nothingFoundMessage="No voices found"
        placeholder="Auto-detected"
        allowDeselect={true}
        clearable
      />
    </Stack>
  );
}
