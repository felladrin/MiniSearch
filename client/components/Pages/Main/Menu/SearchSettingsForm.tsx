import { Stack, Switch } from "@mantine/core";
import { useForm } from "@mantine/form";
import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../../../modules/pubSub";

export default function SearchSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  return (
    <Stack gap="md">
      <Switch
        {...form.getInputProps("enableImageSearch", {
          type: "checkbox",
        })}
        label="Image Search"
        labelPosition="left"
        description="Enable or disable image search results. When enabled, relevant images will be displayed alongside web search results."
      />
    </Stack>
  );
}
