import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  disableWebGpuUsageSettingPubSub,
  numberOfThreadsSettingPubSub,
  searchResultsToConsiderSettingPubSub,
  webLlmModelSettingPubSub,
} from "../modules/pubSub";
import { isF16Supported, isWebGPUAvailable } from "../modules/webGpu";
import { match, Pattern } from "ts-pattern";
import {
  VStack,
  Stack,
  InputNumber,
  Checkbox,
  Text,
  Divider,
  SelectPicker,
} from "rsuite";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { useRef } from "react";
import { backgroundImageSettingPubSub } from "../modules/pubSub";
import { backgroundImageOptions } from "../modules/backgroundImage";

export function SettingsForm() {
  const [disableAiResponse, setDisableAiResponse] = usePubSub(
    disableAiResponseSettingPubSub,
  );
  const [disableWebGpuUsage, setDisableWebGpuUsage] = usePubSub(
    disableWebGpuUsageSettingPubSub,
  );
  const [numberOfThreads, setNumberOfThreads] = usePubSub(
    numberOfThreadsSettingPubSub,
  );
  const [searchResultsToConsider, setSearchResultsToConsider] = usePubSub(
    searchResultsToConsiderSettingPubSub,
  );
  const [webLlmModel, setWebLlmModel] = usePubSub(webLlmModelSettingPubSub);
  const [backgroundImage, setBackgroundImage] = usePubSub(
    backgroundImageSettingPubSub,
  );
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

  return (
    <VStack>
      <Stack.Item>
        <Checkbox
          checked={disableAiResponse}
          onChange={(_, checked) => setDisableAiResponse(checked)}
        >
          Disable AI response
        </Checkbox>
        <Text size="sm" muted>
          Disables the AI response, in case you only want to see the links from
          the web search results.
        </Text>
        <Divider />
      </Stack.Item>
      {isWebGPUAvailable && (
        <Stack.Item>
          <Checkbox
            checked={disableWebGpuUsage}
            onChange={(_, checked) => setDisableWebGpuUsage(checked)}
          >
            Disable WebGPU usage
          </Checkbox>
          <Text size="sm" muted>
            Disables the WebGPU usage, in case you only want to see the links
            from the web search results.
          </Text>
          <Divider />
        </Stack.Item>
      )}
      {match([isWebGPUAvailable, disableWebGpuUsage])
        .with([true, false], () => (
          <Stack.Item>
            <VStack>
              <SelectPicker
                label="WebGPU Model"
                value={webLlmModel}
                onChange={(value) => value && setWebLlmModel(value)}
                placement="auto"
                cleanable={false}
                preventOverflow={true}
                style={{ width: 265 }}
                data={webGpuModels.current}
              />
              <Text size="sm" muted>
                Select the model to use for AI responses when WebGPU is enabled.
              </Text>
            </VStack>
            <Divider />
          </Stack.Item>
        ))
        .with([false, Pattern.any], [Pattern.any, true], () => (
          <Stack.Item>
            <VStack>
              <InputNumber
                prefix="CPU threads to use"
                value={numberOfThreads}
                onChange={(value) =>
                  setNumberOfThreads(Math.max(Number(value), 1))
                }
              />
              <Text size="sm" muted>
                Number of threads to use for the AI model. Lower values will use
                less CPU, but may take longer to respond. A too-high value may
                cause the app to hang. Note that this value is ignored when
                using WebGPU.
              </Text>
            </VStack>
            <Divider />
          </Stack.Item>
        ))
        .otherwise(() => null)}
      <Stack.Item>
        <VStack>
          <InputNumber
            prefix="Search results to consider"
            value={searchResultsToConsider}
            onChange={(value) =>
              setSearchResultsToConsider(
                Math.min(Math.max(Number(value), 0), 6),
              )
            }
          />
          <Text size="sm" muted>
            Determines the number of search results to consider when generating
            AI responses. A higher value may enhance accuracy, but it will also
            increase response time.
          </Text>
        </VStack>
        <Divider />
      </Stack.Item>
      <Stack.Item>
        <VStack>
          <SelectPicker
            label="Background"
            value={backgroundImage}
            onChange={(value) => value && setBackgroundImage(value)}
            placement="auto"
            searchable={false}
            cleanable={false}
            preventOverflow={true}
            style={{ width: 265 }}
            data={backgroundImageOptions}
          />
          <Text size="sm" muted>
            Select a background image for decoration.
          </Text>
        </VStack>
      </Stack.Item>
    </VStack>
  );
}
