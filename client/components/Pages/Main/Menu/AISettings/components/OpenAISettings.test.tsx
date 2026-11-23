import { MantineProvider } from "@mantine/core";
import { useForm } from "@mantine/form";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@/modules/settings";
import { OpenAISettings } from "./OpenAISettings";

function Harness({
  onValuesChange,
}: {
  onValuesChange: (values: typeof defaultSettings) => void;
}) {
  const form = useForm({
    initialValues: defaultSettings,
    onValuesChange,
  });

  return <OpenAISettings form={form} openAiModels={[]} useTextInput={false} />;
}

describe("OpenAISettings", () => {
  it("keeps a context length below the default after blur", () => {
    const onValuesChange = vi.fn();
    render(
      <MantineProvider>
        <Harness onValuesChange={onValuesChange} />
      </MantineProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Context Length" });

    fireEvent.change(input, { target: { value: "2048" } });
    fireEvent.blur(input);

    expect(input).toHaveValue("2048");
    expect(onValuesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ openAiContextLength: 2048 }),
      expect.anything(),
    );
  });
});
