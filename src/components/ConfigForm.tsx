import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  summarizeLinksSettingPubSub,
  useLargerModelSettingPubSub,
} from "../modules/pubSub";
import { Tooltip } from "react-tooltip";

export function ConfigForm() {
  const [disableAiResponse, setDisableAiResponse] = usePubSub(
    disableAiResponseSettingPubSub,
  );
  const [summarizeLinks, setSummarizeLinks] = usePubSub(
    summarizeLinksSettingPubSub,
  );
  const [useLargerModel, setUseLargerModel] = usePubSub(
    useLargerModelSettingPubSub,
  );

  return (
    <details>
      <summary>Settings</summary>
      <div>
        <Tooltip
          id="disable-ai-setting-tooltip"
          place="top-start"
          variant="info"
          opacity="1"
          style={{ width: "75vw", maxWidth: "600px" }}
        />
        <label
          data-tooltip-id="disable-ai-setting-tooltip"
          data-tooltip-content="Disables the AI response, in case you only want to see the links from the web search results"
        >
          <input
            type="checkbox"
            checked={disableAiResponse}
            onChange={(event) => setDisableAiResponse(event.target.checked)}
          />
          Disable AI response
        </label>
      </div>
      <div>
        <Tooltip
          id="summarize-links-setting-tooltip"
          place="top-start"
          variant="info"
          opacity="1"
          style={{ width: "75vw", maxWidth: "600px" }}
        />
        <label
          data-tooltip-id="summarize-links-setting-tooltip"
          data-tooltip-content="Provides a short overview for each of the links from the web search results"
        >
          <input
            type="checkbox"
            checked={summarizeLinks}
            onChange={(event) => setSummarizeLinks(event.target.checked)}
          />
          Summarize links
        </label>
      </div>
      <div>
        <Tooltip
          id="use-large-model-setting-tooltip"
          place="top-start"
          variant="info"
          opacity="1"
          style={{ width: "75vw", maxWidth: "600px" }}
        />
        <label
          data-tooltip-id="use-large-model-setting-tooltip"
          data-tooltip-content="Generates better responses, but takes longer to load"
        >
          <input
            type="checkbox"
            checked={useLargerModel}
            onChange={(event) => setUseLargerModel(event.target.checked)}
          />
          Use a larger AI model
        </label>
      </div>
    </details>
  );
}
