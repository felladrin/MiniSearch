import { usePubSub } from "create-pubsub/react";
import {
  promptPubSub,
  responsePubSub,
  searchResultsPubSub,
  urlsDescriptionsPubSub,
} from "../modules/pubSub";
import { ConfigForm } from "./ConfigForm";
import { SearchForm } from "./SearchForm";
import { ResponseView } from "./ResponseView";

export function App() {
  const [prompt] = usePubSub(promptPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [urlsDescriptions] = usePubSub(urlsDescriptionsPubSub);

  return (
    <>
      {new URLSearchParams(window.location.search).has("q") ? (
        <ResponseView
          prompt={prompt}
          response={response}
          searchResults={searchResults}
          urlsDescriptions={urlsDescriptions}
        />
      ) : (
        <>
          <SearchForm />
          <ConfigForm />
        </>
      )}
    </>
  );
}
