import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  summarizeLinksSettingPubSub,
  useLargerModelSettingPubSub,
  disableWebGpuUsageSettingPubSub,
} from "../modules/pubSub";
import { Tooltip } from "react-tooltip";
import { isWebGPUAvailable } from "../modules/webGpu";
import type { ChangeEventHandler } from "react";

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
        <SettingCheckbox
          label="Use a larger AI model"
          checked={useLargerModel}
          onChange={(event) => setUseLargerModel(event.target.checked)}
          tooltipId="use-large-model-setting-tooltip"
          tooltipContent="Generates better responses, but takes longer to load"
        />
      </div>
      <div>
        <SettingCheckbox
          label="Summarize links"
          checked={summarizeLinks}
          onChange={(event) => setSummarizeLinks(event.target.checked)}
          tooltipId="summarize-links-setting-tooltip"
          tooltipContent="Provides a short overview for each of the links from the web search results"
        />
      </div>
      {isWebGPUAvailable && (
        <div>
          <SettingCheckbox
            label="Disable WebGPU usage"
            checked={disableWebGpuUsage}
            onChange={(event) => setDisableWebGpuUsage(event.target.checked)}
            tooltipId="use-large-model-setting-tooltip"
            tooltipContent="Disables the WebGPU and run smaller AI models only using the CPU"
          />
        </div>
      )}
      <div>
        <SettingCheckbox
          label="Disable AI response"
          checked={disableAiResponse}
          onChange={(event) => setDisableAiResponse(event.target.checked)}
          tooltipId="disable-ai-setting-tooltip"
          tooltipContent="Disables the AI response, in case you only want to see the links from the web search results"
        />
      </div>
    </div>
  );
}

function SettingCheckbox(props: {
  label: string;
  checked?: boolean;
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
      >
        <input
          type="checkbox"
          checked={props.checked}
          onChange={props.onChange}
        />
        {props.label}
      </label>
    </>
  );
}
