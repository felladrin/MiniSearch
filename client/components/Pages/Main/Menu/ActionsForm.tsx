import { Stack } from "@mantine/core";
import ShowLogsButton from "@/components/Logs/ShowLogsButton";
import ClearDataButton from "./ClearDataButton";

export default function ActionsForm() {
  return (
    <Stack gap="lg">
      <ClearDataButton />
      <ShowLogsButton />
    </Stack>
  );
}
