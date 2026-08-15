import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnableAiResponsePrompt from "./EnableAiResponsePrompt";

describe("EnableAiResponsePrompt", () => {
  it("is announced politely (status), not assertively (alert)", () => {
    render(
      <MantineProvider>
        <EnableAiResponsePrompt onAccept={() => {}} onDecline={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers accept and decline", () => {
    render(
      <MantineProvider>
        <EnableAiResponsePrompt onAccept={() => {}} onDecline={() => {}} />
      </MantineProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Yes, please" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "No, thanks" }),
    ).toBeInTheDocument();
  });
});
