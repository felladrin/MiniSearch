import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  summarizeLinksSettingPubSub,
  useLargerModelSettingPubSub,
  disableWebGpuUsageSettingPubSub,
  numberOfThreadsSettingPubSub,
} from "../modules/pubSub";
import { Tooltip } from "react-tooltip";
import { isWebGPUAvailable } from "../modules/webGpu";
import type { ChangeEventHandler, HTMLInputTypeAttribute } from "react";

export function SettingsForm() {
  const [disableAiResponse, setDisableAiResponse] = usePubSub(
    disableAiResponseSettingPubSub,
  );
  const [summarizeLinks, setSummarizeLinks] = usePubSub(
    summarizeLinksSettingPubSub,
  );
  const [useLargerModel, setUseLargerModel] = usePubSub(
    useLargerModelSettingPubSub,
  );
  const [disableWebGpuUsage, setDisableWebGpuUsage] = usePubSub(
    disableWebGpuUsageSettingPubSub,
  );
  const [numberOfThreads, setNumberOfThreads] = usePubSub(
    numberOfThreadsSettingPubSub,
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
          label="Use a larger AI model"
          type="checkbox"
          checked={useLargerModel}
          onChange={(event) => setUseLargerModel(event.target.checked)}
          tooltipId="use-large-model-setting-tooltip"
          tooltipContent="Generates better responses, but takes longer to load"
        />
      </div>
      <div>
        <SettingInput
          label="Summarize links"
          type="checkbox"
          checked={summarizeLinks}
          onChange={(event) => setSummarizeLinks(event.target.checked)}
          tooltipId="summarize-links-setting-tooltip"
          tooltipContent="Provides a short overview for each of the links from the web search results"
        />
      </div>
      <div>
        <SettingInput
          label="Disable AI response"
          type="checkbox"
          checked={disableAiResponse}
          onChange={(event) => setDisableAiResponse(event.target.checked)}
          tooltipId="disable-ai-setting-tooltip"
          tooltipContent="Disables the AI response, in case you only want to see the links from the web search results"
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
            tooltipContent="Disables the WebGPU and run smaller AI models only using the CPU"
          />
        </div>
      )}
      {(!isWebGPUAvailable || disableWebGpuUsage) && (
        <div>
          <SettingInput
            label="CPU threads to use"
            type="number"
            value={numberOfThreads}
            onChange={(event) => setNumberOfThreads(Number(event.target.value))}
            tooltipId="number-of-threads-setting-tooltip"
            tooltipContent="Number of threads to use for the AI model. Lower values will use less CPU, but may take longer to respond. A too-high value may cause the app to hang. Note that this value is ignored when using WebGPU."
          />
        </div>
      )}
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
