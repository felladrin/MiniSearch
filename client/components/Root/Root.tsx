import { Route } from "wouter";
import { Layout } from "../Layout/Layout";
import { useInitializeSettings } from "./useInitializeSettings";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";

export function Root() {
  useInitializeSettings();

  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications />
      <Route path="/" component={Layout} />
    </MantineProvider>
  );
}
