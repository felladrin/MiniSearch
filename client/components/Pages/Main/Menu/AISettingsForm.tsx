import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../../../modules/pubSub";
import { isWebGPUAvailable } from "../../../../modules/webGpu";
import { match, Pattern } from "ts-pattern";
import {
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Textarea,
  Text,
  TextInput,
  Group,
  ComboboxData,
  Skeleton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { lazy, Suspense, useEffect, useState } from "react";
import { defaultSettings, inferenceTypes } from "../../../../modules/settings";
import { getOpenAiClient } from "../../../../modules/openai";
import { IconInfoCircle } from "@tabler/icons-react";
import { addLogEntry } from "../../../../modules/logEntries";

const WebLlmModelSelect = lazy(
  () => import("../../../AiResponse/WebLlmModelSelect"),
);
const WllamaModelSelect = lazy(
  () => import("../../../AiResponse/WllamaModelSelect"),
);

export default function AISettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [openAiModels, setOpenAiModels] = useState<ComboboxData>([]);

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
        form.setFieldError("openAiApiModel", null);
        if (!form.values.openAiApiModel) {
          form.setFieldValue("openAiApiModel", models[0].value);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching OpenAI models: ${errorMessage}`);
        setOpenAiModels([]);
        form.setFieldError("openAiApiModel", errorMessage);
      }
    }

    if (form.values.inferenceType === "openai") {
      fetchOpenAiModels();
    }
  }, [
    form.values.inferenceType,
    settings.openAiApiBaseUrl,
    settings.openAiApiKey,
  ]);

  const isUsingCustomInstructions =
    form.values.systemPrompt !== defaultSettings.systemPrompt;

  const handleRestoreDefaultInstructions = () => {
    form.setFieldValue("systemPrompt", defaultSettings.systemPrompt);
  };

  const suggestedCpuThreads =
    (navigator.hardwareConcurrency &&
      Math.max(
        defaultSettings.cpuThreads,
        navigator.hardwareConcurrency - 2,
      )) ??
    defaultSettings.cpuThreads;

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
              <Select
                {...form.getInputProps("openAiApiModel")}
                label="API Model"
                data={openAiModels}
                description="Optional, as some API servers don't provide a model list."
                allowDeselect={false}
                searchable
              />
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

              {match([isWebGPUAvailable, form.values.enableWebGpu])
                .with([true, true], () => (
                  <Suspense fallback={<Skeleton height={50} />}>
                    <WebLlmModelSelect
                      value={form.values.webLlmModelId}
                      onChange={(value) =>
                        form.setFieldValue("webLlmModelId", value)
                      }
                    />
                  </Suspense>
                ))
                .with([false, Pattern.any], [Pattern.any, false], () => (
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
                        <>
                          <span>
                            Number of threads to use for the AI model. Lower
                            values will use less CPU but may take longer to
                            respond. A value that is too high may cause the app
                            to hang.
                          </span>
                          {suggestedCpuThreads > defaultSettings.cpuThreads && (
                            <span>
                              {" "}
                              The default value is{" "}
                              <Text
                                component="span"
                                size="xs"
                                c="blue"
                                style={{ cursor: "pointer" }}
                                onClick={() =>
                                  form.setFieldValue(
                                    "cpuThreads",
                                    defaultSettings.cpuThreads,
                                  )
                                }
                              >
                                {defaultSettings.cpuThreads}
                              </Text>
                              , but based on the number of logical processors in
                              your CPU, the suggested value is{" "}
                              <Text
                                component="span"
                                size="xs"
                                c="blue"
                                style={{ cursor: "pointer" }}
                                onClick={() =>
                                  form.setFieldValue(
                                    "cpuThreads",
                                    suggestedCpuThreads,
                                  )
                                }
                              >
                                {suggestedCpuThreads}
                              </Text>
                              .
                            </span>
                          )}
                        </>
                      }
                      min={1}
                      {...form.getInputProps("cpuThreads")}
                    />
                  </>
                ))
                .otherwise(() => null)}
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
                  The special tag <em>{`{{searchResults}}`}</em> will be
                  replaced with the search results, while{" "}
                  <em>{`{{dateTime}}`}</em> will be replaced with the current
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
        </>
      )}
    </Stack>
  );
}
