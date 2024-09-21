import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../modules/pubSub";
import { Stack, Switch } from "@mantine/core";
import { useForm } from "@mantine/form";

export function InterfaceSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });

  return (
    <form>
      <Stack gap="md">
        <Switch
          label="Enter to Submit"
          {...form.getInputProps("enterToSubmit", {
            type: "checkbox",
          })}
          description="Enable or disable using Enter key to submit the search query. When disabled, you'll need to click the Search button or use Shift+Enter to submit."
        />
      </Stack>
    </form>
  );
}
