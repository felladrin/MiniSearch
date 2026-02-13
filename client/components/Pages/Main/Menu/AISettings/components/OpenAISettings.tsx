import { Group, NumberInput, Select, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconInfoCircle } from "@tabler/icons-react";
import { defaultSettings } from "@/modules/settings";
import type { ModelOption } from "../types";

/**
 * Props for the OpenAISettings component
 */
interface OpenAISettingsProps {
  /** Form instance for managing OpenAI API settings */
  form: UseFormReturnType<typeof defaultSettings>;
  /** Available OpenAI-compatible models */
  openAiModels: ModelOption[];
  /** Whether to use text input instead of select for model */
  useTextInput: boolean;
}

/**
 * Component for managing OpenAI API settings.
 * Provides controls for API base URL, API key, model selection, and context length.
 */
export const OpenAISettings = ({
  form,
  openAiModels,
  useTextInput,
}: OpenAISettingsProps) => (
  <>
    <TextInput
      {...form.getInputProps("openAiApiBaseUrl")}
      label="API Base URL"
      placeholder="http://localhost:11434/v1"
      required
    />
    <Group gap="xs">
      <IconInfoCircle size={16} />
      <Text size="xs" c="dimmed" flex={1}>
        You may need to add{" "}
        <em>{`${self.location.protocol}//${self.location.hostname}`}</em> to the
        list of allowed network origins in your API server settings.
      </Text>
    </Group>
    <TextInput
      {...form.getInputProps("openAiApiKey")}
      label="API Key"
      type="password"
      description="Optional, as local API servers usually do not require it."
    />
    {useTextInput ? (
      <TextInput
        {...form.getInputProps("openAiApiModel")}
        label="API Model"
        description="Enter the model identifier"
      />
    ) : (
      <Select
        {...form.getInputProps("openAiApiModel")}
        label="API Model"
        data={openAiModels}
        description="Optional, as some API servers don't provide a model list."
        allowDeselect={false}
        disabled={openAiModels.length === 0}
        searchable
        clearable
      />
    )}
    <NumberInput
      label="Context Length"
      description={`Maximum number of tokens the model can consider. Defaults to ${defaultSettings.openAiContextLength}.`}
      defaultValue={defaultSettings.openAiContextLength}
      {...form.getInputProps("openAiContextLength")}
      step={defaultSettings.openAiContextLength}
      min={defaultSettings.openAiContextLength}
    />
  </>
);
