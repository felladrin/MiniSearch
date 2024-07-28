import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  disableWebGpuUsageSettingPubSub,
  numberOfThreadsSettingPubSub,
  searchResultsToConsiderSettingPubSub,
} from "../modules/pubSub";
import { Tooltip } from "react-tooltip";
import { isWebGPUAvailable } from "../modules/webGpu";
import type { ChangeEventHandler, HTMLInputTypeAttribute } from "react";
import { match, Pattern } from "ts-pattern";
import { isRunningOnMobile } from "../modules/mobileDetection";

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
    <div>
      <div
        style={{
          textAlign: "center",
          fontSize: "16px",
          fontWeight: "bolder",
          margin: "10px",
        }}
      >
        Settings
      </div>
      <div>
        <SettingInput
          label="Disable AI response"
          type="checkbox"
          checked={disableAiResponse}
          onChange={(event) => setDisableAiResponse(event.target.checked)}
          tooltipId="disable-ai-setting-tooltip"
          tooltipContent="Disables the AI response, in case you only want to see the links from the web search results."
        />
      </div>
      {isWebGPUAvailable && (
        <div>
          <SettingInput
            label="Disable WebGPU usage"
            type="checkbox"
            checked={disableWebGpuUsage}
            onChange={(event) => setDisableWebGpuUsage(event.target.checked)}
            tooltipId="use-large-model-setting-tooltip"
            tooltipContent="Disables the WebGPU and run smaller AI models only using the CPU."
          />
        </div>
      )}
      {match([isRunningOnMobile, isWebGPUAvailable, disableWebGpuUsage])
        .with([false, false, Pattern.any], [false, Pattern.any, true], () => (
          <div>
            <SettingInput
              label="CPU threads to use"
              type="number"
              value={numberOfThreads}
              onChange={({ target }) =>
                setNumberOfThreads(Number(target.value))
              }
              tooltipId="number-of-threads-setting-tooltip"
              tooltipContent="Number of threads to use for the AI model. Lower values will use less CPU, but may take longer to respond. A too-high value may cause the app to hang. Note that this value is ignored when using WebGPU."
            />
          </div>
        ))
        .otherwise(() => null)}
      <div>
        <SettingInput
          label="Search results to consider"
          type="number"
          value={searchResultsToConsider}
          onChange={({ target }) =>
            setSearchResultsToConsider(
              Math.min(Math.max(Number(target.value), 0), 6),
            )
          }
          tooltipId="search-results-to-reference-setting-tooltip"
          tooltipContent="Determines the number of search results to consider when generating AI responses. A higher value may enhance accuracy, but it will also increase response time."
        />
      </div>
    </div>
  );
}

function SettingInput(props: {
  label: string;
  type: HTMLInputTypeAttribute;
  checked?: boolean;
  value?: string | number | readonly string[];
  onChange?: ChangeEventHandler<HTMLInputElement>;
  tooltipId?: string;
  tooltipContent?: string;
}) {
  return (
    <>
      <Tooltip
        id={props.tooltipId}
        place="top-start"
        variant="info"
        opacity="1"
        style={{ maxWidth: "90vw" }}
      />
      <label
        data-tooltip-id={props.tooltipId}
        data-tooltip-content={props.tooltipContent}
        style={{ textAlign: "center" }}
      >
        <input
          type={props.type}
          value={props.value}
          checked={props.checked}
          onChange={props.onChange}
          style={{ textAlign: "center" }}
        />
        {props.label}
      </label>
    </>
  );
}
