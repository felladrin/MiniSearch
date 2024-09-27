import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../modules/pubSub";
import { isWebGPUAvailable } from "../../modules/webGpu";
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
import { inferenceTypes } from "../../modules/settings";
import { OpenAI } from "openai";
import { IconInfoCircle } from "@tabler/icons-react";

const WebLlmModelSelect = lazy(() => import("./WebLlmModelSelect"));
const WllamaModelSelect = lazy(() => import("./WllamaModelSelect"));

export function AISettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [openAiModels, setOpenAiModels] = useState<ComboboxData>([]);

  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  useEffect(() => {
    async function fetchOpenAiModels() {
      try {
        const openai = new OpenAI({
          baseURL: settings.openAiApiBaseUrl,
          apiKey: settings.openAiApiKey,
          dangerouslyAllowBrowser: true,
        });
        const response = await openai.models.list();
        const models = response.data.map((model) => ({
          label: model.id,
          value: model.id,
        }));
        setOpenAiModels(models);
      } catch (error) {
        console.error("Error fetching OpenAI models:", error);
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
            label="Inference Type"
            data={inferenceTypes}
            allowDeselect={false}
          />

          {form.values.inferenceType === "openai" && (
            <>
              <TextInput
                {...form.getInputProps("openAiApiBaseUrl")}
                label="API Base URL"
                placeholder="http://localhost:10001/v1"
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
                      description="Number of threads to use for the AI model. Lower values will use less CPU, but may take longer to respond. A too-high value may cause the app to hang."
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
                  Note: The special tag <em>{`{{searchResults}}`}</em> will be
                  replaced with the search results, while{" "}
                  <em>{`{{dateTime}}`}</em> will be replaced with the current
                  date and time.
                </span>
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
