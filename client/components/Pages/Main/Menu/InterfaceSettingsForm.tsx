import {
  Stack,
  Switch,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useSettingsForm } from "@/hooks/useSettingsForm";

const SETTINGS_KEYS = ["enterToSubmit"] as const;

export default function InterfaceSettingsForm() {
  const form = useSettingsForm(SETTINGS_KEYS);
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
