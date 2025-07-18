import { Select, Slider, Stack, Switch, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { usePubSub } from "create-pubsub/react";
import { useMemo } from "react";
import { settingsPubSub } from "../../../../../modules/pubSub";
import {
  defaultSettings,
  inferenceTypes,
} from "../../../../../modules/settings";
import { isWebGPUAvailable } from "../../../../../modules/webGpu";
import { AIParameterSlider } from "./components/AIParameterSlider";
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

  const inferenceTypeSupportsMinP =
    (form.values.inferenceType === "browser" &&
      (!isWebGPUAvailable || !form.values.enableWebGpu)) ||
    form.values.inferenceType === "horde";

  const penaltySliderMarks = useMemo(
    () => [
      { value: -2.0, label: "-2.0" },
      { value: 0.0, label: "0" },
      { value: 2.0, label: "2.0" },
    ],
    [],
  );

  const probabilitySliderMarks = useMemo(
    () =>
      Array.from({ length: 3 }, (_, index) => ({
        value: index / 2,
        label: (index / 2).toString(),
      })),
    [],
  );

  const searchResultsToConsiderSliderMarks = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => ({
        value: index,
        label: index.toString(),
      })),
    [],
  );

  const temperatureSliderMarks = useMemo(
    () => [
      { value: 0, label: "0" },
      { value: 1, label: "1" },
      { value: 2, label: "2" },
    ],
    [],
  );

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
            <BrowserSettings
              form={form}
              isWebGPUAvailable={isWebGPUAvailable}
            />
          )}

          <SystemPromptInput form={form} />

          <AIParameterSlider
            label="Temperature"
            description="Controls randomness in responses. Lower values make responses more focused and deterministic, while higher values make them more creative and diverse."
            defaultValue={defaultSettings.inferenceTemperature}
            {...form.getInputProps("inferenceTemperature")}
            min={0}
            max={2}
            step={0.01}
            marks={temperatureSliderMarks}
          />

          <AIParameterSlider
            label="Top P"
            description="Controls diversity by limiting cumulative probability of tokens. Lower values make responses more focused, while higher values allow more variety."
            defaultValue={defaultSettings.inferenceTopP}
            {...form.getInputProps("inferenceTopP")}
            min={0}
            max={1}
            step={0.01}
            marks={probabilitySliderMarks}
          />

          {inferenceTypeSupportsMinP && (
            <AIParameterSlider
              label="Min P"
              description="Sets a minimum probability for token selection. Helps to filter out very unlikely tokens, making responses more coherent."
              defaultValue={defaultSettings.minP}
              {...form.getInputProps("minP")}
              min={0}
              max={1}
              step={0.01}
              marks={probabilitySliderMarks}
            />
          )}

          <AIParameterSlider
            label="Frequency Penalty"
            description="Reduces repetition by penalizing tokens based on their frequency. Higher values decrease the likelihood of repeating the same information."
            defaultValue={defaultSettings.inferenceFrequencyPenalty}
            {...form.getInputProps("inferenceFrequencyPenalty")}
            min={-2.0}
            max={2.0}
            step={0.01}
            marks={penaltySliderMarks}
          />

          <AIParameterSlider
            label="Presence Penalty"
            description="Encourages new topics by penalizing tokens that have appeared. Higher values increase the model's likelihood to talk about new topics."
            defaultValue={defaultSettings.inferencePresencePenalty}
            {...form.getInputProps("inferencePresencePenalty")}
            min={-2.0}
            max={2.0}
            step={0.01}
            marks={penaltySliderMarks}
          />

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
