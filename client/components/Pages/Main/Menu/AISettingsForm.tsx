import {
  Group,
  NumberInput,
  Select,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { Suspense, lazy, useEffect, useState } from "react";
import { addLogEntry } from "../../../../modules/logEntries";
import { getOpenAiClient } from "../../../../modules/openai";
import { settingsPubSub } from "../../../../modules/pubSub";
import { defaultSettings, inferenceTypes } from "../../../../modules/settings";
import {
  aiHordeDefaultApiKey,
  fetchHordeModels,
} from "../../../../modules/textGenerationWithHorde";
import { isWebGPUAvailable } from "../../../../modules/webGpu";

const WebLlmModelSelect = lazy(
  () => import("../../../AiResponse/WebLlmModelSelect"),
);
const WllamaModelSelect = lazy(
  () => import("../../../AiResponse/WllamaModelSelect"),
);

const penaltySliderMarks = [
  { value: -2.0, label: "-2.0" },
  { value: 0.0, label: "0" },
  { value: 2.0, label: "2.0" },
];

export default function AISettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [openAiModels, setOpenAiModels] = useState<
    {
      label: string;
      value: string;
    }[]
  >([]);
  const [hordeModels, setHordeModels] = useState<
    {
      label: string;
      value: string;
    }[]
  >([]);
  const [useTextInput, setUseTextInput] = useState(false);

  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  useEffect(() => {
    async function fetchOpenAiModels() {
      try {
        const openai = getOpenAiClient({
          baseURL: settings.openAiApiBaseUrl,
          apiKey: settings.openAiApiKey,
        });
        const response = await openai.models.list();
        const models = response.data.map((model) => ({
          label: model.id,
          value: model.id,
        }));
        setOpenAiModels(models);
        setUseTextInput(false);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching OpenAI models: ${errorMessage}`);
        setOpenAiModels([]);
        setUseTextInput(true);
      }
    }

    if (settings.inferenceType === "openai" && settings.openAiApiBaseUrl) {
      fetchOpenAiModels();
    }
  }, [
    settings.inferenceType,
    settings.openAiApiBaseUrl,
    settings.openAiApiKey,
  ]);

  useEffect(() => {
    async function fetchAvailableHordeModels() {
      try {
        const models = await fetchHordeModels();
        const formattedModels = models.map((model) => ({
          label: model.name,
          value: model.name,
        }));
        setHordeModels(formattedModels);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching AI Horde models: ${errorMessage}`);
        setHordeModels([]);
      }
    }

    if (settings.inferenceType === "horde") {
      fetchAvailableHordeModels();
    }
  }, [settings.inferenceType]);

  useEffect(() => {
    if (openAiModels.length > 0) {
      const hasNoModelSelected = !form.values.openAiApiModel;
      const isModelInvalid = !openAiModels.find(
        (model) => model.value === form.values.openAiApiModel,
      );

      if (hasNoModelSelected || isModelInvalid) {
        form.setFieldValue("openAiApiModel", openAiModels[0].value);
      }
    }
  }, [openAiModels, form.setFieldValue, form.values.openAiApiModel]);

  const isUsingCustomInstructions =
    form.values.systemPrompt !== defaultSettings.systemPrompt;

  const handleRestoreDefaultInstructions = () => {
    form.setFieldValue("systemPrompt", defaultSettings.systemPrompt);
  };

  return (
    <Stack gap="md">
      <Switch
        label="AI Response"
        {...form.getInputProps("enableAiResponse", {
          type: "checkbox",
        })}
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
              marks={Array.from({ length: 7 }, (_, index) => ({
                value: index,
                label: index.toString(),
              }))}
            />
          </Stack>

          <Select
            {...form.getInputProps("inferenceType")}
            label="AI Processing Location"
            data={inferenceTypes}
            allowDeselect={false}
          />

          {form.values.inferenceType === "openai" && (
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
                  <em>
                    {`${self.location.protocol}//${self.location.hostname}`}
                  </em>{" "}
                  to the list of allowed network origins in your API server
                  settings.
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
                />
              )}
            </>
          )}

          {form.values.inferenceType === "horde" && (
            <>
              <TextInput
                label="API Key"
                description="By default, it's set to '0000000000', for anonymous access. However, anonymous accounts have the lowest priority when there's too many concurrent requests."
                type="password"
                {...form.getInputProps("hordeApiKey")}
              />
              {form.values.hordeApiKey.length > 0 &&
                form.values.hordeApiKey !== aiHordeDefaultApiKey && (
                  <Select
                    label="Model"
                    description="Optional. When not selected, AI Horde will automatically choose an available model."
                    placeholder="Auto-selected"
                    data={hordeModels}
                    {...form.getInputProps("hordeModel")}
                    searchable
                    clearable
                  />
                )}
            </>
          )}

          {form.values.inferenceType === "browser" && (
            <>
              {isWebGPUAvailable && (
                <Switch
                  label="WebGPU"
                  {...form.getInputProps("enableWebGpu", {
                    type: "checkbox",
                  })}
                  labelPosition="left"
                  description="Enable or disable WebGPU usage. When disabled, the app will use the CPU instead."
                />
              )}

              {isWebGPUAvailable && form.values.enableWebGpu ? (
                <Suspense fallback={<Skeleton height={50} />}>
                  <WebLlmModelSelect
                    value={form.values.webLlmModelId}
                    onChange={(value) =>
                      form.setFieldValue("webLlmModelId", value)
                    }
                  />
                </Suspense>
              ) : (
                <>
                  <Suspense fallback={<Skeleton height={50} />}>
                    <WllamaModelSelect
                      value={form.values.wllamaModelId}
                      onChange={(value) =>
                        form.setFieldValue("wllamaModelId", value)
                      }
                    />
                  </Suspense>
                  <NumberInput
                    label="CPU threads to use"
                    description={
                      <span>
                        Number of threads to use for the AI model. Lower values
                        will use less CPU but may take longer to respond. A
                        value that is too high may cause the app to hang.
                      </span>
                    }
                    min={1}
                    {...form.getInputProps("cpuThreads")}
                  />
                </>
              )}
            </>
          )}

          <Textarea
            label="Instructions for AI"
            descriptionProps={{ component: "div" }}
            description={
              <>
                <span>
                  Customize instructions for the AI to tailor its responses.
                </span>
                <br />
                <span>For example:</span>
                <ul>
                  <li>
                    Specify preferences
                    <ul>
                      <li>
                        <em>"use simple language"</em>
                      </li>
                      <li>
                        <em>"provide step-by-step explanations"</em>
                      </li>
                    </ul>
                  </li>
                  <li>
                    Set a response style
                    <ul>
                      <li>
                        <em>"answer in a friendly tone"</em>
                      </li>
                      <li>
                        <em>"write your response in Spanish"</em>
                      </li>
                    </ul>
                  </li>
                  <li>
                    Provide context about the audience
                    <ul>
                      <li>
                        <em>"you're talking to a high school student"</em>
                      </li>
                      <li>
                        <em>
                          "consider that your audience is composed of
                          professionals in the field of graphic design"
                        </em>
                      </li>
                    </ul>
                  </li>
                </ul>
                <span>
                  The special tag <em>{"{{searchResults}}"}</em> will be
                  replaced with the search results, while{" "}
                  <em>{"{{dateTime}}"}</em> will be replaced with the current
                  date and time.
                </span>
                {isUsingCustomInstructions && (
                  <>
                    <br />
                    <br />
                    <span>
                      Currently, you're using custom instructions. If you ever
                      need to restore the default instructions, you can do so by
                      clicking
                    </span>{" "}
                    <Text
                      component="span"
                      size="xs"
                      c="blue"
                      style={{ cursor: "pointer" }}
                      onClick={handleRestoreDefaultInstructions}
                    >
                      here
                    </Text>
                    <span>.</span>
                  </>
                )}
              </>
            }
            autosize
            maxRows={10}
            {...form.getInputProps("systemPrompt")}
          />

          <Stack gap="xs" mb="md">
            <Text size="sm">Temperature</Text>
            <Text size="xs" c="dimmed">
              Controls randomness in responses. Lower values make responses more
              focused and deterministic, while higher values make them more
              creative and diverse. Defaults to{" "}
              {defaultSettings.inferenceTemperature}.
            </Text>
            <Slider
              {...form.getInputProps("inferenceTemperature")}
              min={0}
              max={2}
              step={0.01}
              marks={[
                { value: 0, label: "0" },
                { value: 1, label: "1" },
                { value: 2, label: "2" },
              ]}
            />
          </Stack>

          <Stack gap="xs" mb="md">
            <Text size="sm">Top P</Text>
            <Text size="xs" c="dimmed">
              Controls diversity by limiting cumulative probability of tokens.
              Lower values make responses more focused, while higher values
              allow more variety. Defaults to {defaultSettings.inferenceTopP}.
            </Text>
            <Slider
              {...form.getInputProps("inferenceTopP")}
              min={0}
              max={1}
              step={0.01}
              marks={Array.from({ length: 3 }, (_, index) => ({
                value: index / 2,
                label: (index / 2).toString(),
              }))}
            />
          </Stack>

          <Stack gap="xs" mb="md">
            <Text size="sm">Frequency Penalty</Text>
            <Text size="xs" c="dimmed">
              Reduces repetition by penalizing tokens based on their frequency.
              Higher values decrease the likelihood of repeating the same
              information. Defaults to{" "}
              {defaultSettings.inferenceFrequencyPenalty}.
            </Text>
            <Slider
              {...form.getInputProps("inferenceFrequencyPenalty")}
              min={-2.0}
              max={2.0}
              step={0.01}
              marks={penaltySliderMarks}
            />
          </Stack>

          <Stack gap="xs" mb="md">
            <Text size="sm">Presence Penalty</Text>
            <Text size="xs" c="dimmed">
              Encourages new topics by penalizing tokens that have appeared.
              Higher values increase the model's likelihood to talk about new
              topics. Defaults to {defaultSettings.inferencePresencePenalty}.
            </Text>
            <Slider
              {...form.getInputProps("inferencePresencePenalty")}
              min={-2.0}
              max={2.0}
              step={0.01}
              marks={penaltySliderMarks}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}
