import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DictationButton from "@/components/Search/Form/DictationButton";
import {
  DictationError,
  getDictationEngine,
  startDictation,
} from "@/modules/speechToText";

vi.mock("@/modules/speechToText", async () => {
  const { DictationError: RealDictationError } = await import(
    "@/modules/speechToText"
  );
  return {
    DictationError: RealDictationError,
    getDictationEngine: vi.fn(() => "wasm" as const),
    startDictation: vi.fn(),
  };
});

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn((pubSub: unknown) => {
    if (!Array.isArray(pubSub)) return [undefined, vi.fn()];
    const maybeFactory = pubSub[2];
    if (typeof maybeFactory !== "function") return [undefined, vi.fn()];
    return [maybeFactory() ?? undefined, vi.fn()];
  }),
}));

function renderButton(getText = () => "", setText = (_text: string) => {}) {
  return render(
    <MantineProvider>
      <DictationButton getText={getText} setText={setText} />
    </MantineProvider>,
  );
}

const stopFn = vi.fn();

beforeEach(() => {
  vi.mocked(getDictationEngine).mockReturnValue("wasm");
  vi.mocked(startDictation).mockResolvedValue({ stop: stopFn });
  vi.mocked(notifications.show).mockClear();
  stopFn.mockClear();
});

it("renders a dictation button with an accessible label", () => {
  renderButton();
  expect(
    screen.getByRole("button", { name: "Dictate the search query" }),
  ).toBeInTheDocument();
});

it("hides when no dictation engine is available", () => {
  vi.mocked(getDictationEngine).mockReturnValue(null);
  renderButton();
  expect(
    screen.queryByRole("button", { name: /dictate/i }),
  ).not.toBeInTheDocument();
});

it("hides when the setting is off", async () => {
  const { settingsPubSub } = await import("@/modules/pubSub");
  settingsPubSub[0]({
    ...(settingsPubSub[2]?.() ?? {}),
    enableDictation: false,
  });
  try {
    renderButton();
    expect(
      screen.queryByRole("button", { name: /dictate/i }),
    ).not.toBeInTheDocument();
  } finally {
    // Restored even on a failure: this channel is module state, so leaking
    // `false` would hide the button in every later test in this file.
    settingsPubSub[0]({
      ...(settingsPubSub[2]?.() ?? {}),
      enableDictation: true,
    });
  }
});

it("switches to the recording state and stops on the second press", async () => {
  const user = userEvent.setup();
  renderButton();

  await user.click(
    screen.getByRole("button", { name: "Dictate the search query" }),
  );

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Stop dictating the search query" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );

  await user.click(
    screen.getByRole("button", { name: "Stop dictating the search query" }),
  );

  expect(stopFn).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Dictate the search query" }),
  ).toHaveAttribute("aria-pressed", "false");
});

it("shows a notification when microphone permission is denied", async () => {
  vi.mocked(startDictation).mockRejectedValue(
    new DictationError("permission", "Permission denied"),
  );
  const user = userEvent.setup();
  renderButton();

  await user.click(
    screen.getByRole("button", { name: "Dictate the search query" }),
  );

  await waitFor(() =>
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Microphone permission denied",
        color: "red",
      }),
    ),
  );
});

it("splices the transcript into the field without clobbering the base text", async () => {
  let value = "existing query";
  const getText = () => value;
  const setText = (text: string) => {
    value = text;
  };
  let onTranscript: (text: string) => void = () => {};

  vi.mocked(startDictation).mockImplementation(async (callbacks) => {
    onTranscript = callbacks.onTranscript;
    return { stop: stopFn };
  });

  const user = userEvent.setup();
  renderButton(getText, setText);

  await user.click(
    screen.getByRole("button", { name: "Dictate the search query" }),
  );

  onTranscript("hello");
  expect(value).toBe("existing query hello");

  onTranscript("hello world");
  expect(value).toBe("existing query hello world");

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Stop dictating the search query" }),
    ).toBeInTheDocument(),
  );
});

describe("teardown", () => {
  it("releases the microphone when the button unmounts mid-recording", async () => {
    const user = userEvent.setup();
    const { unmount } = renderButton();

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(1));
    expect(stopFn).not.toHaveBeenCalled();

    // `SearchForm` remounts the moment the query goes non-empty, so this is
    // the primary flow, not a corner case.
    unmount();

    await waitFor(() => expect(stopFn).toHaveBeenCalledTimes(1));
  });

  it("discards a session that arrives after the setting was turned off", async () => {
    const user = userEvent.setup();
    const { settingsPubSub } = await import("@/modules/pubSub");
    let release: ((session: { stop: () => Promise<void> }) => void) | undefined;
    vi.mocked(startDictation).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    renderButton();
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(1));

    try {
      // Mid-load, with the session not yet in the ref: the button disappears,
      // and the microphone would otherwise open with nothing to stop it.
      settingsPubSub[0]({
        ...(settingsPubSub[2]?.() ?? {}),
        enableDictation: false,
      });
      release?.({ stop: stopFn });

      await waitFor(() => expect(stopFn).toHaveBeenCalledTimes(1));
    } finally {
      settingsPubSub[0]({
        ...(settingsPubSub[2]?.() ?? {}),
        enableDictation: true,
      });
    }
  });

  it("notifies and stops when the engine fails after it loaded", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(1));

    const { onError } = vi.mocked(startDictation).mock.calls[0][0];
    onError?.(new DictationError("engine", "the transcriber died"));

    await waitFor(() => expect(stopFn).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notifications.show)).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Dictation stopped" }),
    );
  });
});
