import { Select, Slider, Stack, Switch, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { usePubSub } from "create-pubsub/react";
import { useMemo } from "react";
import { settingsPubSub } from "@/modules/pubSub";
import { inferenceTypes } from "@/modules/settings";
import { requestNotificationPermission } from "@/modules/notifications";
import { BrowserSettings } from "./components/BrowserSettings";
import { HordeSettings } from "./components/HordeSettings";
import { OpenAISettings } from "./components/OpenAISettings";
import { SystemPromptInput } from "./components/SystemPromptInput";
import { useHordeModels } from "./hooks/useHordeModels";
import { useHordeUserInfo } from "./hooks/useHordeUserInfo";
import { useOpenAiModels } from "./hooks/useOpenAiModels";

export default function AISettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const { openAiModels, useTextInput } = useOpenAiModels(settings);
  const hordeModels = useHordeModels(settings);
  const hordeUserInfo = useHordeUserInfo(settings);

  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  const searchResultsToConsiderSliderMarks = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => ({
        value: index,
        label: index.toString(),
      })),
    [],
  );

  const handleNotificationToggle = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (event.target.checked) {
      const permission = await requestNotificationPermission();
      if (permission !== "granted") {
        return;
      }
    }
    form.setFieldValue("enableNotificationOnAiComplete", event.target.checked);
  };

  return (
    <Stack gap="md">
      <Switch
        label="AI Response"
        {...form.getInputProps("enableAiResponse", { type: "checkbox" })}
        labelPosition="left"
        description="Enable or disable AI-generated responses to your queries. When disabled, you'll only see web search results."
      />

      {form.values.enableAiResponse && (
        <>
          <Switch
            label="Notification on AI Complete"
            {...form.getInputProps("enableNotificationOnAiComplete", {
              type: "checkbox",
              onChange: handleNotificationToggle,
            })}
            labelPosition="left"
            description="Show a browser notification when AI summary generation is complete. Useful for longer queries that take time to process."
          />

          <Stack gap="xs" mb="md">
            <Text size="sm">Search results to consider</Text>
            <Text size="xs" c="dimmed">
              Determines the number of search results to consider when
              generating AI responses. A higher value may enhance accuracy, but
              it will also increase response time.
            </Text>
            <Slider
              {...form.getInputProps("searchResultsToConsider")}
              min={0}
              max={6}
              marks={searchResultsToConsiderSliderMarks}
            />
          </Stack>

          <Select
            {...form.getInputProps("inferenceType")}
            label="AI Processing Location"
            data={inferenceTypes}
            allowDeselect={false}
          />

          {form.values.inferenceType === "openai" && (
            <OpenAISettings
              form={form}
              openAiModels={openAiModels}
              useTextInput={useTextInput}
            />
          )}

          {form.values.inferenceType === "horde" && (
            <HordeSettings
              form={form}
              hordeUserInfo={hordeUserInfo}
              hordeModels={hordeModels}
            />
          )}

          {form.values.inferenceType === "browser" && (
            <BrowserSettings form={form} />
          )}

          <SystemPromptInput form={form} />

          <Stack gap="xs" mb="md">
            <Text size="sm">Reasoning Section Parsing</Text>
            <Text size="xs" c="dimmed">
              Configure how the AI's reasoning section is parsed in the
              response.
            </Text>
            <Stack gap="xs">
              <TextInput
                {...form.getInputProps("reasoningStartMarker")}
                description="Start Marker, indicating the start of a reasoning section."
              />
              <TextInput
                {...form.getInputProps("reasoningEndMarker")}
                description="End Marker, indicating the end of a reasoning section."
              />
            </Stack>
          </Stack>
        </>
      )}
    </Stack>
  );
}
