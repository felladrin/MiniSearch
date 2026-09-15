import { MantineProvider } from "@mantine/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePubSub } from "create-pubsub/react";
import type { SearchEntry } from "@/modules/history";
import HistoryButton from "./HistoryButton";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn(),
}));

let drawerProps: {
  opened: boolean;
  onClose: () => void;
  onSearchSelect?: (entry: SearchEntry) => void;
} | null = null;

vi.mock("./HistoryDrawer", () => ({
  default: function HistoryDrawerStub(props: {
    opened: boolean;
    onClose: () => void;
    onSearchSelect?: (entry: SearchEntry) => void;
  }) {
    drawerProps = props;
    return <div>history-drawer-open</div>;
  },
}));

function mockSettings(enableHistory: boolean) {
  vi.mocked(usePubSub).mockReturnValue([{ enableHistory }, vi.fn()]);
}

const renderButton = (onSearchSelect?: (entry: SearchEntry) => void) => {
  return render(
    <MantineProvider>
      <HistoryButton onSearchSelect={onSearchSelect} />
    </MantineProvider>,
  );
};

describe("HistoryButton component", () => {
  beforeEach(() => {
    mockSettings(true);
    drawerProps = null;
  });

  it("hides the button when history is disabled", () => {
    mockSettings(false);
    renderButton();
    expect(
      screen.queryByRole("button", { name: "History" }),
    ).not.toBeInTheDocument();
  });

  it("shows the button when history is enabled", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "History" })).toBeVisible();
  });

  it("opens the drawer when the button is clicked", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: "History" }));

    expect(await screen.findByText("history-drawer-open")).toBeVisible();
  });

  it("closes the drawer when the drawer reports its on-close", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("history-drawer-open");

    act(() => drawerProps?.onClose());
    expect(screen.queryByText("history-drawer-open")).not.toBeInTheDocument();
  });

  it("closes the drawer and selects the entry chosen in it", async () => {
    const onSearchSelect = vi.fn();
    const user = userEvent.setup();
    renderButton(onSearchSelect);
    await user.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("history-drawer-open");

    const entry: SearchEntry = {
      id: 1,
      query: "quantum tunneling",
      timestamp: Date.now(),
    };
    act(() => drawerProps?.onSearchSelect?.(entry));

    expect(onSearchSelect).toHaveBeenCalledWith(entry);
    expect(screen.queryByText("history-drawer-open")).not.toBeInTheDocument();
  });
});
