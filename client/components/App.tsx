import { Route } from "wouter";
import { Main } from "./Main";
import { useInitializeSettings } from "../hooks/useInitializeSettings";
import { useBackgroundImageEffect } from "../hooks/useBackgroundImageEffect";

export function App() {
  const settings = useInitializeSettings();
  useBackgroundImageEffect(settings.backgroundImageUrl);

  return <Route path="/" component={Main} />;
}
