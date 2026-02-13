import { Slider, Stack, Text } from "@mantine/core";
import type { AIParameterSliderProps } from "../types";

/**
 * Slider component for AI parameters with label and description
 * @param label - The parameter label
 * @param description - Parameter description text
 * @param defaultValue - Default value for the parameter
 * @param props - Additional props to pass to Slider component
 */
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
