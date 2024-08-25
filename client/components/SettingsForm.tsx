import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  disableWebGpuUsageSettingPubSub,
  numberOfThreadsSettingPubSub,
  searchResultsToConsiderSettingPubSub,
  webLlmModelSettingPubSub,
} from "../modules/pubSub";
import { isWebGPUAvailable } from "../modules/webGpu";
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
                searchable={false}
                style={{ width: 265 }}
                data={[
                  {
                    label: "Small (Qwen2 0.5B Instruct)",
                    value: "mlc-q4f16_1-Qwen2-0.5B-Instruct",
                  },
                  {
                    label: "Medium (Phi 3.5 Mini Instruct)",
                    value: "mlc-q4f16-Phi-3.5-mini-instruct",
                  },
                ]}
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
                onChange={(value) => setNumberOfThreads(Number(value))}
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
      </Stack.Item>
    </VStack>
  );
}
