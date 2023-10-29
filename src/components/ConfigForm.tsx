import { usePubSub } from "create-pubsub/react";
import {
  disableAiResponseSettingPubSub,
  summarizeLinksSettingPubSub,
  useLargerModelSettingPubSub,
} from "../modules/pubSub";

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
        <label title="Disables the AI response, in case you only want to see the links from the web search results">
          <input
            type="checkbox"
            checked={disableAiResponse}
            onChange={(event) => setDisableAiResponse(event.target.checked)}
          />
          Disable AI response
        </label>
      </div>
      <div>
        <label title="Provides a short overview for each of the links from the web search results">
          <input
            type="checkbox"
            checked={summarizeLinks}
            onChange={(event) => setSummarizeLinks(event.target.checked)}
          />
          Summarize links
        </label>
      </div>
      <div>
        <label title="Generates better responses, but takes longer to load">
          <input
            type="checkbox"
            checked={useLargerModel}
            onChange={(event) => setUseLargerModel(event.target.checked)}
          />
          Use a better AI model
        </label>
      </div>
    </details>
  );
}
