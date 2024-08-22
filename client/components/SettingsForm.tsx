import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  disableWebGpuUsageSettingPubSub,
  numberOfThreadsSettingPubSub,
  searchResultsToConsiderSettingPubSub,
} from "../modules/pubSub";
import { isWebGPUAvailable } from "../modules/webGpu";
import { match, Pattern } from "ts-pattern";
import { Whisper, Tooltip, VStack, Stack, InputNumber, Checkbox } from "rsuite";

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

  return (
    <VStack>
      <Stack.Item>
        <Checkbox
          checked={disableAiResponse}
          onChange={(_, checked) => setDisableAiResponse(checked)}
        >
          <Whisper
            placement="top"
            trigger="hover"
            controlId="disable-ai-setting-tooltip"
            speaker={
              <Tooltip>
                Disables the AI response, in case you only want to see the links
                from the web search results.
              </Tooltip>
            }
          >
            Disable AI response
          </Whisper>
        </Checkbox>
      </Stack.Item>

      {isWebGPUAvailable && (
        <Stack.Item>
          <Checkbox
            checked={disableWebGpuUsage}
            onChange={(_, checked) => setDisableWebGpuUsage(checked)}
          >
            <Whisper
              placement="top"
              trigger="hover"
              controlId="disable-webgpu-setting-tooltip"
              speaker={
                <Tooltip>
                  Disables the WebGPU usage, in case you only want to see the
                  links from the web search results.
                </Tooltip>
              }
            >
              Disable WebGPU usage
            </Whisper>
          </Checkbox>
        </Stack.Item>
      )}

      {match([isWebGPUAvailable, disableWebGpuUsage])
        .with([false, Pattern.any], [Pattern.any, true], () => (
          <Stack.Item>
            <Whisper
              placement="top"
              trigger="hover"
              controlId="number-of-threads-setting-tooltip"
              speaker={
                <Tooltip>
                  Number of threads to use for the AI model. Lower values will
                  use less CPU, but may take longer to respond. A too-high value
                  may cause the app to hang. Note that this value is ignored
                  when using WebGPU.
                </Tooltip>
              }
            >
              <InputNumber
                prefix="CPU threads to use"
                value={numberOfThreads}
                onChange={(value) => setNumberOfThreads(Number(value))}
              />
            </Whisper>
          </Stack.Item>
        ))
        .otherwise(() => null)}

      <Stack.Item>
        <Whisper
          placement="top"
          trigger="hover"
          controlId="search-results-to-reference-setting-tooltip"
          speaker={
            <Tooltip>
              Determines the number of search results to consider when
              generating AI responses. A higher value may enhance accuracy, but
              it will also increase response time.
            </Tooltip>
          }
        >
          <InputNumber
            prefix="Search results to consider"
            value={searchResultsToConsider}
            onChange={(value) =>
              setSearchResultsToConsider(
                Math.min(Math.max(Number(value), 0), 6),
              )
            }
          />
        </Whisper>
      </Stack.Item>
    </VStack>
  );
}
