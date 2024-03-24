import { usePubSub } from "create-pubsub/react";
import {
  promptPubSub,
  responsePubSub,
  searchResultsPubSub,
  urlsDescriptionsPubSub,
} from "../modules/pubSub";
import { SearchForm } from "./SearchForm";
import { ResponseView } from "./ResponseView";
import { Toaster } from "react-hot-toast";
import { SettingsButton } from "./SettingsButton";

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
        <div>
          <SearchForm />
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <SettingsButton />
          </div>
        </div>
      )}

      <Toaster />
    </>
  );
}
