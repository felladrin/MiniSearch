import { Slider, Stack, Text } from "@mantine/core";
import type { AIParameterSliderProps } from "../types";

export const AIParameterSlider = ({
  label,
  description,
  defaultValue,
  ...props
}: AIParameterSliderProps) => (
  <Stack gap="xs" mb="md">
    <Text size="sm">{label}</Text>
    <Text size="xs" c="dimmed">
      {description} Defaults to {defaultValue}.
    </Text>
    <Slider {...props} />
  </Stack>
);
