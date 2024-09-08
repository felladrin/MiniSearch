import { Route } from "wouter";
import { Main } from "./Main/Main";
import { useInitializeSettings } from "./useInitializeSettings";
import { useBackgroundImageEffect } from "./useBackgroundImageEffect";

export function App() {
  const settings = useInitializeSettings();
  useBackgroundImageEffect(settings.backgroundImageUrl);

  return <Route path="/" component={Main} />;
}
