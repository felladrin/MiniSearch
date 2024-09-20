import { Route } from "wouter";
import { Layout } from "../Layout/Layout";
import { useInitializeSettings } from "./useInitializeSettings";

export function Root() {
  useInitializeSettings();

  return <Route path="/" component={Layout} />;
}
