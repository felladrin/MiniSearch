import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../modules/pubSub";
import {
  Stack,
  Switch,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";

export default function InterfaceSettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const form = useForm({
    initialValues: settings,
    onValuesChange: setSettings,
  });
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  return (
    <Stack gap="md">
      <Switch
        label="Dark Mode"
        checked={computedColorScheme === "dark"}
        onChange={toggleColorScheme}
        labelPosition="left"
        description="Enable or disable the dark color scheme."
        styles={{ labelWrapper: { width: "100%" } }}
      />

      <Switch
        {...form.getInputProps("enableImageSearch", {
          type: "checkbox",
        })}
        label="Image Search"
        labelPosition="left"
        description="Enable or disable image search results. When enabled, relevant images will be displayed alongside web search results."
      />

      <Switch
        {...form.getInputProps("enterToSubmit", {
          type: "checkbox",
        })}
        label="Enter to Submit"
        labelPosition="left"
        description="Enable or disable using Enter key to submit the search query. When disabled, you'll need to click the Search button or use Shift+Enter to submit."
      />
    </Stack>
  );
}
