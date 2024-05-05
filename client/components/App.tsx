import { usePubSub } from "create-pubsub/react";
import {
  promptPubSub,
  responsePubSub,
  searchResultsPubSub,
  urlsDescriptionsPubSub,
} from "../modules/pubSub";
import { SearchForm } from "./SearchForm";
import { Toaster } from "react-hot-toast";
import Markdown from "markdown-to-jsx";
import { getDisableAiResponseSetting } from "../modules/pubSub";
import { SearchResultsList } from "./SearchResultsList";
import { useEffect } from "react";
import { prepareTextGeneration } from "../modules/textGeneration";

export function App() {
  const [query, updateQuery] = usePubSub(promptPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [urlsDescriptions] = usePubSub(urlsDescriptionsPubSub);

  useEffect(() => {
    prepareTextGeneration();
  }, []);

  return (
    <>
      <SearchForm query={query} updateQuery={updateQuery} />
      {!getDisableAiResponseSetting() && response.length > 0 && (
        <div
          style={{
            backgroundColor: "var(--background)",
            borderRadius: "6px",
            padding: "10px 25px",
          }}
        >
          <Markdown>{response}</Markdown>
        </div>
      )}
      {searchResults.length > 0 && (
        <div>
          <SearchResultsList
            searchResults={searchResults}
            urlsDescriptions={urlsDescriptions}
          />
        </div>
      )}
      <Toaster />
    </>
  );
}
