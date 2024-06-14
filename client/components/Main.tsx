import { usePubSub } from "create-pubsub/react";
import {
  queryPubSub,
  responsePubSub,
  searchResultsPubSub,
  urlsDescriptionsPubSub,
} from "../modules/pubSub";
import { SearchForm } from "./SearchForm";
import { Toaster } from "react-hot-toast";
import Markdown from "markdown-to-jsx";
import { getDisableAiResponseSetting } from "../modules/pubSub";
import { SearchResultsList } from "./SearchResultsList";
import { match, Pattern } from "ts-pattern";

export function Main() {
  const [query, updateQuery] = usePubSub(queryPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [urlsDescriptions] = usePubSub(urlsDescriptionsPubSub);

  return (
    <>
      <SearchForm query={query} updateQuery={updateQuery} />
      {match([getDisableAiResponseSetting(), response.length])
        .with([false, Pattern.number.positive()], () => (
          <div
            style={{
              backgroundColor: "var(--background)",
              borderRadius: "6px",
              padding: "10px 25px",
            }}
          >
            <Markdown>{response}</Markdown>
          </div>
        ))
        .otherwise(() => null)}
      {match(searchResults.length)
        .with(Pattern.number.positive(), () => (
          <div>
            <SearchResultsList
              searchResults={searchResults}
              urlsDescriptions={urlsDescriptions}
            />
          </div>
        ))
        .otherwise(() => null)}
      <Toaster />
    </>
  );
}
