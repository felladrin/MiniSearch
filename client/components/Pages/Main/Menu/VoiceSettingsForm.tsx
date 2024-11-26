import { Select, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { usePubSub } from "create-pubsub/react";
import { useEffect, useState } from "react";
import { settingsPubSub } from "../../../../modules/pubSub";

export default function VoiceSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [voices, setVoices] = useState<{ value: string; label: string }[]>([]);

  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  useEffect(() => {
    const updateVoices = () => {
      const availableVoices = self.speechSynthesis.getVoices();
      const voiceOptions = availableVoices.map((voice) => ({
        value: voice.voiceURI,
        label: `${voice.lang} - ${voice.name}`,
      }));
      setVoices(voiceOptions.sort((a, b) => a.label.localeCompare(b.label)));
    };

    updateVoices();

    self.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      self.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

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
        placeholder="Select a voice"
      />
    </Stack>
  );
}
