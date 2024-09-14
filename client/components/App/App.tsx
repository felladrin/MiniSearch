import { Route } from "wouter";
import { Main } from "./Main/Main";
import { useInitializeSettings } from "./useInitializeSettings";

export function App() {
  useInitializeSettings();

  return <Route path="/" component={Main} />;
}
