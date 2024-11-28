import { Select, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import getUnicodeFlagIcon from "country-flag-icons/unicode";
import { usePubSub } from "create-pubsub/react";
import { useCallback, useEffect, useState } from "react";
import { settingsPubSub } from "../../../../modules/pubSub";

export default function VoiceSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [voices, setVoices] = useState<{ value: string; label: string }[]>([]);

  const getCountryFlag = useCallback((langCode: string) => {
    try {
      const country = langCode.split("-")[1];

      if (country.length !== 2) throw new Error("Invalid country code");

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
    const updateVoices = () => {
      const availableVoices = self.speechSynthesis.getVoices();
      const uniqueVoices = Array.from(
        new Map(
          availableVoices.map((voice) => [voice.voiceURI, voice]),
        ).values(),
      );
      const voiceOptions = uniqueVoices
        .sort((a, b) => a.lang.localeCompare(b.lang))
        .map((voice) => ({
          value: voice.voiceURI,
          label: `${getCountryFlag(voice.lang)} ${voice.name} • ${voice.lang}`,
        }));
      setVoices(voiceOptions);
    };

    updateVoices();

    self.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      self.speechSynthesis.onvoiceschanged = null;
    };
  }, [getCountryFlag]);

  return (
    <Stack gap="xs">
      <Text size="sm">Voice Selection</Text>
      <Text size="xs" c="dimmed">
        Choose the voice to use when reading AI responses aloud.
      </Text>
      <Select
        {...form.getInputProps("selectedVoiceId")}
        data={voices}
        searchable
        nothingFoundMessage="No voices found"
        placeholder="Auto-detected"
        allowDeselect={true}
        clearable
      />
    </Stack>
  );
}
