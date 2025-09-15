import { Group, Select, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconInfoCircle } from "@tabler/icons-react";
import type { defaultSettings } from "../../../../../../modules/settings";
import type { ModelOption } from "../types";

interface OpenAISettingsProps {
  form: UseFormReturnType<typeof defaultSettings>;
  openAiModels: ModelOption[];
  useTextInput: boolean;
}

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
  </>
);
