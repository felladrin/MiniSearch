import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../../../../modules/pubSub";
import {
  isF16Supported,
  isWebGPUAvailable,
} from "../../../../../modules/webGpu";
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
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { useRef, useEffect, useState } from "react";
import { Setting, inferenceTypes } from "../../../../../modules/settings";
import { wllamaModels } from "../../../../../modules/wllama";
import { OpenAI } from "openai";

export function SettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [openAiModels, setOpenAiModels] = useState<
    { label: string; value: string }[]
  >([]);

  const suffix = isF16Supported ? "-q4f16_1-MLC" : "-q4f32_1-MLC";

  const webGpuModels = useRef(
    prebuiltAppConfig.model_list
      .filter((model) => model.model_id.endsWith(suffix))
      .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
      .map((model) => ({
        label: `${model.model_id.replace(suffix, "")} • ${
          Math.round(model.vram_required_MB ?? 0) || "N/A"
        } MB`,
        value: model.model_id,
      })),
  );

  useEffect(
    function validateWebGpuModel() {
      const isCurrentModelValid = webGpuModels.current.some(
        (model) => model.value === settings.webLlmModelId,
      );

      if (!isCurrentModelValid) {
        setSettings({
          ...settings,
          webLlmModelId: webGpuModels.current[0].value,
        });
      }
    },
    [settings.webLlmModelId],
  );

  const wllamaModelOptions = useRef(
    Object.entries(wllamaModels).map(([value, { label }]) => ({
      label,
      value,
    })),
  );

  useEffect(
    function validateWllamaModel() {
      const isCurrentModelValid = wllamaModelOptions.current.some(
        (model) => model.value === settings.wllamaModelId,
      );

      if (!isCurrentModelValid) {
        setSettings({
          ...settings,
          wllamaModelId: wllamaModelOptions.current[0].value,
        });
      }
    },
    [settings.wllamaModelId],
  );

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

    if (form.values[Setting.inferenceType] === "openai") {
      fetchOpenAiModels();
    }
  }, [
    form.values[Setting.inferenceType],
    settings.openAiApiBaseUrl,
    settings.openAiApiKey,
  ]);

  return (
    <form>
      <Stack gap="md">
        <Switch
          label="AI Response"
          {...form.getInputProps(Setting.enableAiResponse, {
            type: "checkbox",
          })}
          description="Enable or disable AI-generated responses to your queries. When disabled, you'll only see web search results."
        />

        {form.values[Setting.enableAiResponse] && (
          <>
            <Stack gap="xs" mb="md" ml={50}>
              <Text size="sm">Search results to consider</Text>
              <Text size="xs" c="dimmed">
                Determines the number of search results to consider when
                generating AI responses. A higher value may enhance accuracy,
                but it will also increase response time.
              </Text>
              <Slider
                {...form.getInputProps(Setting.searchResultsToConsider)}
                min={0}
                max={6}
                marks={[
                  { value: 0, label: "0" },
                  { value: 1, label: "1" },
                  { value: 2, label: "2" },
                  { value: 3, label: "3" },
                  { value: 4, label: "4" },
                  { value: 5, label: "5" },
                  { value: 6, label: "6" },
                ]}
              />
            </Stack>

            <Select
              label="Inference Type"
              data={inferenceTypes}
              {...form.getInputProps(Setting.inferenceType)}
            />

            {form.values[Setting.inferenceType] === "openai" && (
              <>
                <TextInput
                  required
                  label="API Base URL"
                  {...form.getInputProps(Setting.openAiApiBaseUrl)}
                  description="Example: http://localhost:11434/v1"
                />
                <TextInput
                  label="API Key"
                  type="password"
                  {...form.getInputProps(Setting.openAiApiKey)}
                />
                <Select
                  label="API Model"
                  data={openAiModels}
                  {...form.getInputProps(Setting.openAiApiModel)}
                />
              </>
            )}

            {form.values[Setting.inferenceType] === "browser" && (
              <>
                {isWebGPUAvailable && (
                  <Switch
                    label="WebGPU"
                    {...form.getInputProps(Setting.enableWebGpu, {
                      type: "checkbox",
                    })}
                    description="Enable or disable WebGPU usage. When disabled, the app will use the CPU instead."
                  />
                )}

                {match([isWebGPUAvailable, form.values[Setting.enableWebGpu]])
                  .with([true, true], () => (
                    <Select
                      label="AI Model"
                      description="Select the model to use for AI responses."
                      data={webGpuModels.current}
                      {...form.getInputProps(Setting.webLlmModelId)}
                    />
                  ))
                  .with([false, Pattern.any], [Pattern.any, false], () => (
                    <>
                      <Select
                        label="AI Model"
                        description="Select the model to use for AI responses."
                        data={wllamaModelOptions.current}
                        {...form.getInputProps(Setting.wllamaModelId)}
                      />
                      <NumberInput
                        label="CPU threads to use"
                        description="Number of threads to use for the AI model. Lower values will use less CPU, but may take longer to respond. A too-high value may cause the app to hang."
                        min={1}
                        {...form.getInputProps(Setting.cpuThreads)}
                      />
                    </>
                  ))
                  .otherwise(() => null)}
              </>
            )}
          </>
        )}

        <Switch
          label="Image Search"
          {...form.getInputProps(Setting.enableImageSearch, {
            type: "checkbox",
          })}
          description="Enable or disable image search results. When enabled, relevant images will be displayed alongside web search results."
        />

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
                    <li>"use simple language"</li>
                    <li>"provide step-by-step explanations"</li>
                  </ul>
                </li>
                <li>
                  Set a response style
                  <ul>
                    <li>"answer in a friendly tone"</li>
                    <li>"write your response in Spanish"</li>
                  </ul>
                </li>
                <li>
                  Provide context about the audience
                  <ul>
                    <li>"you're talking to a high school student"</li>
                    <li>
                      "consider that your audience is composed of professionals
                      in the field of graphic design"
                    </li>
                  </ul>
                </li>
              </ul>
              <span>
                Note: The special tag <code>{`{{searchResults}}`}</code> will be
                replaced with the search results, while{" "}
                <code>{`{{dateTime}}`}</code> will be replaced with the current
                date and time.
              </span>
            </>
          }
          autosize
          maxRows={10}
          {...form.getInputProps(Setting.systemPrompt)}
        />
      </Stack>
    </form>
  );
}
