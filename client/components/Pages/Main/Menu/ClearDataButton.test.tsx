import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClearDataButton from "./ClearDataButton";

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/modules/logEntries", () => ({
  addLogEntry: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClearDataButton", () => {
  it("names everything it deletes in the confirmation", async () => {
    const confirm = vi.spyOn(self, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ClearDataButton />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Clear all data" }));

    const [message] = confirm.mock.calls[0];
    for (const category of [
      "settings",
      "cached files",
      "saved searches",
      "AI responses",
      "chat messages",
    ]) {
      expect(message).toContain(category);
    }
  });

  it("deletes nothing when the confirmation is declined", async () => {
    vi.spyOn(self, "confirm").mockReturnValue(false);
    const clear = vi.spyOn(Storage.prototype, "clear");
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ClearDataButton />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Clear all data" }));

    expect(clear).not.toHaveBeenCalled();
  });
});
