import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../modules/pubSub";
import { isF16Supported, isWebGPUAvailable } from "../../modules/webGpu";
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
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect, useState } from "react";
import { inferenceTypes } from "../../modules/settings";
import { OpenAI } from "openai";
import { IconInfoCircle } from "@tabler/icons-react";

export function AISettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [openAiModels, setOpenAiModels] = useState<ComboboxData>([]);
  const [webGpuModels, setWebGpuModels] = useState<ComboboxData>([]);
  const [wllamaModelOptions, setWllamaModelOptions] = useState<ComboboxData>(
    [],
  );

  useEffect(() => {
    async function loadWebGpuModels() {
      const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");

      const suffix = isF16Supported ? "-q4f16_1-MLC" : "-q4f32_1-MLC";

      const models = prebuiltAppConfig.model_list
        .filter((model) => model.model_id.endsWith(suffix))
        .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
        .map((model) => ({
          label: `${model.model_id.replace(suffix, "")} • ${
            Math.round(model.vram_required_MB ?? 0) || "N/A"
          } MB`,
          value: model.model_id,
        }));

      setWebGpuModels(models);

      const isCurrentModelValid = models.some(
        (model) => model.value === settings.webLlmModelId,
      );

      if (!isCurrentModelValid) {
        setSettings({
          ...settings,
          webLlmModelId: models[0].value,
        });
      }
    }

    loadWebGpuModels();
  }, []);

  useEffect(() => {
    async function loadWllamaModels() {
      const { wllamaModels } = await import("../../modules/wllama");

      const models = Object.entries(wllamaModels).map(([value, { label }]) => ({
        label,
        value,
      }));

      setWllamaModelOptions(models);

      const isCurrentModelValid = models.some(
        (model) => model.value === settings.wllamaModelId,
      );

      if (!isCurrentModelValid) {
        setSettings({
          ...settings,
          wllamaModelId: models[0].value,
        });
      }
    }

    loadWllamaModels();
  }, []);

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
            label="Inference Type"
            data={inferenceTypes}
            {...form.getInputProps("inferenceType")}
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
                  description="Enable or disable WebGPU usage. When disabled, the app will use the CPU instead."
                />
              )}

              {match([isWebGPUAvailable, form.values.enableWebGpu])
                .with([true, true], () => (
                  <Select
                    label="AI Model"
                    description="Select the model to use for AI responses."
                    data={webGpuModels}
                    {...form.getInputProps("webLlmModelId")}
                  />
                ))
                .with([false, Pattern.any], [Pattern.any, false], () => (
                  <>
                    <Select
                      label="AI Model"
                      description="Select the model to use for AI responses."
                      data={wllamaModelOptions}
                      {...form.getInputProps("wllamaModelId")}
                    />
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
