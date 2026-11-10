import {
  type ComboboxItem,
  type ComboboxItemGroup,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import getUnicodeFlagIcon from "country-flag-icons/unicode";
import { usePubSub } from "create-pubsub/react";
import { useCallback, useEffect, useState } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import {
  listVoices,
  type TextToSpeechEngine,
  type VoiceOption,
} from "@/modules/textToSpeech";

export default function VoiceSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);

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

    const updateVoices = () => {
      listVoices(undefined, settings.textToSpeechEngine).then((options) => {
        if (!cancelled) setVoiceOptions(options);
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
  }, [settings.textToSpeechEngine]);

  // `listVoices` keeps each language's voices together, so a group only ever
  // continues the one before it.
  const voiceData: (ComboboxItem | ComboboxItemGroup<ComboboxItem>)[] = [];
  for (const option of voiceOptions) {
    const item = {
      value: option.value,
      label: `${getCountryFlag(option.languageCode)} ${option.label}`,
    };
    const previous = voiceData.at(-1);
    if (!option.languageName) voiceData.push(item);
    else if (
      previous &&
      "group" in previous &&
      previous.group === option.languageName
    )
      previous.items.push(item);
    else voiceData.push({ group: option.languageName, items: [item] });
  }

  return (
    <Stack gap="xs">
      <Switch
        {...form.getInputProps("enableDictation", { type: "checkbox" })}
        label="Dictate the search query"
        description="Shows a Dictate button next to the search field. Which engine transcribes the speech is decided by the setting below."
        labelPosition="left"
      />
      <Switch
        {...form.getInputProps("enableLocalDictationModel", {
          type: "checkbox",
        })}
        label="On-device dictation model"
        description="Downloads a ~700 MB model on first use and transcribes many languages without the audio leaving this device. The text appears when you stop recording. Turn it off to use your browser's built-in speech recognition instead, which shows the text as you speak but may send the audio to your browser vendor. On browsers without built-in speech recognition, the on-device model is used regardless."
        labelPosition="left"
        disabled={!settings.enableDictation}
      />
      <Text size="sm">Speech Engine</Text>
      <Text size="xs" c="dimmed">
        The local engine downloads a small neural voice on the first use and
        sounds the same on every platform. The system engine uses the voices
        your operating system provides.
      </Text>
      <Select
        {...form.getInputProps("textToSpeechEngine")}
        onChange={(value) => {
          if (!value || value === form.values.textToSpeechEngine) return;
          // A voice from the engine being left cannot play under the new one,
          // so the selection goes back to auto-detection in the same update.
          form.setValues((current) => ({
            ...current,
            textToSpeechEngine: value as TextToSpeechEngine,
            selectedVoiceId: "",
          }));
        }}
        data={[
          { value: "local", label: "Local neural voice (many languages)" },
          { value: "system", label: "System voices" },
        ]}
        allowDeselect={false}
      />
      <Text size="sm">Voice Selection</Text>
      <Text size="xs" c="dimmed">
        Choose the voice to use when reading AI responses aloud. Only the voices
        of the selected engine are listed. Leave it empty to pick one
        automatically for the language of each response; a voice you choose
        reads every response, whatever its language.
      </Text>
      <Select
        // Remounting drops the label Mantine keeps for the previous value, which
        // would otherwise filter the new engine's list as if it were typed.
        key={settings.textToSpeechEngine}
        {...form.getInputProps("selectedVoiceId")}
        data={voiceData}
        searchable
        nothingFoundMessage="No voices found"
        placeholder="Auto-detected"
        allowDeselect={true}
        clearable
      />
    </Stack>
  );
}
