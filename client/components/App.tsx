import { Route } from "wouter";
import { Main } from "./Main";
import { useEffect } from "react";
import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../modules/pubSub";
import { defaultSettings } from "../modules/settings";
import { DOMHelper } from "rsuite";

export function App() {
  const [settings, setSettings] = usePubSub(settingsPubSub);

  useEffect(() => setSettings({ ...defaultSettings, ...settings }), []);

  useEffect(() => {
    if (!document.body) return;

    if (settings.backgroundImageUrl !== "none") {
      DOMHelper.addStyle(document.body, {
        backgroundImage: `url('${settings.backgroundImageUrl}')`,
      });
    } else {
      DOMHelper.removeStyle(document.body, "background-image");
    }
  }, [settings.backgroundImageUrl]);

  return <Route path="/" component={Main} />;
}
