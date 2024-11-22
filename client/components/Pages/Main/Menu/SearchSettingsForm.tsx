import { Slider, Stack, Switch, Text } from "@mantine/core";
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
      <Stack gap="xs" mb="md">
        <Text size="sm">Search Results Limit</Text>
        <Text size="xs" c="dimmed">
          Maximum number of search results to fetch. A higher value provides
          more results but may increase search time.
        </Text>
        <Slider
          {...form.getInputProps("searchResultsLimit")}
          min={5}
          max={30}
          step={5}
          marks={[5, 10, 15, 20, 25, 30].map((value) => ({
            value,
            label: value.toString(),
          }))}
        />
      </Stack>

      <Switch
        {...form.getInputProps("enableTextSearch", {
          type: "checkbox",
        })}
        label="Text Search"
        labelPosition="left"
        description="Enable or disable text search results. When enabled, relevant web pages will be displayed in the search results."
      />

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
