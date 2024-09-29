import { Stack } from "@mantine/core";
import { Suspense, lazy } from "react";

const ClearDataButton = lazy(() => import("./ClearDataButton"));
const ShowLogsButton = lazy(() => import("./ShowLogsButton"));

export default function ActionsForm() {
  return (
    <Stack gap="lg">
      <Suspense>
        <ClearDataButton />
      </Suspense>
      <Suspense>
        <ShowLogsButton />
      </Suspense>
    </Stack>
  );
}
