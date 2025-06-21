import { Stack } from "@mantine/core";
import { lazy, Suspense } from "react";

const ClearDataButton = lazy(() => import("./ClearDataButton"));
const ShowLogsButton = lazy(() => import("../../../Logs/ShowLogsButton"));

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
