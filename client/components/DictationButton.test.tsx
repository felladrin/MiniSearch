import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import DictationButton from "@/components/DictationButton";
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

/**
 * Subscribes for real rather than reading a snapshot, so a settings change
 * during a test re-renders the button the way it does in the app.
 */
vi.mock("create-pubsub/react", () => ({
  usePubSub: (pubSub: [unknown, unknown, unknown]) => {
    const [publish, subscribe, get] = pubSub as [
      unknown,
      (listener: () => void) => () => void,
      () => unknown,
    ];
    const value = useSyncExternalStore(subscribe, get, get);
    return [value, publish];
  },
}));

function renderButton({
  getValue = () => "",
  setValue = (_value: string) => {},
  labelScope = "the search query",
  disabled = false,
}: {
  getValue?: () => string;
  setValue?: (value: string) => void;
  labelScope?: string;
  disabled?: boolean;
} = {}) {
  return render(
    <MantineProvider>
      <DictationButton
        getValue={getValue}
        setValue={setValue}
        labelScope={labelScope}
        disabled={disabled}
      />
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

it("passes the local-model preference through to the engine", async () => {
  const { settingsPubSub } = await import("@/modules/pubSub");
  settingsPubSub[0]({
    ...(settingsPubSub[2]?.() ?? {}),
    enableLocalDictationModel: false,
  });
  try {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      screen.getByRole("button", { name: "Dictate the search query" }),
    );
    await waitFor(() =>
      expect(startDictation).toHaveBeenCalledWith(expect.anything(), false),
    );
    expect(getDictationEngine).toHaveBeenCalledWith(false);
  } finally {
    settingsPubSub[0]({
      ...(settingsPubSub[2]?.() ?? {}),
      enableLocalDictationModel: true,
    });
  }
});

it("switches to the recording state and stops on the second press", async () => {
  const user = userEvent.setup();
  renderButton();

  await user.click(
    screen.getByRole("button", { name: "Dictate the search query" }),
  );

  // The mirror of the `false` case above: the pubsub holds a literal
  // `true` restored by that test's finally block, so a hardcoded `false`
  // at the forwarding sites fails here. The en-US derivation itself is
  // pinned in settings.test.ts.
  await waitFor(() =>
    expect(startDictation).toHaveBeenCalledWith(expect.anything(), true),
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

describe("the icon-only render", () => {
  it("names the field it fills, so two of them are told apart", () => {
    renderButton({ labelScope: "a follow-up question" });
    expect(
      screen.getByRole("button", { name: "Dictate a follow-up question" }),
    ).toBeInTheDocument();
  });

  it("swaps the microphone for a stop icon while recording", async () => {
    const user = userEvent.setup();
    const { container } = renderButton();

    expect(container.querySelector(".tabler-icon-microphone")).not.toBeNull();

    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(
        container.querySelector(".tabler-icon-player-stop-filled"),
      ).not.toBeNull(),
    );
    // The state has to survive without color: an icon-only control that only
    // turns red says nothing to a colorblind user.
    expect(container.querySelector(".tabler-icon-microphone")).toBeNull();

    // And the color still has to be there for everyone else. Mantine's
    // `subtle` variant resolves `red` to `--mantine-color-red-light-color`,
    // which is #fff5f5 in the dark scheme the app defaults to, so a subtle
    // red button renders an all but white icon. `light` paints the red as a
    // background instead and keeps it in both schemes.
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "light");
  });

  it("stays subtle while idle, so it does not compete with the field", () => {
    renderButton();
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-variant",
      "subtle",
    );
  });

  it("keeps the download progress in the accessible name while it loads", async () => {
    let release: ((session: { stop: () => Promise<void> }) => void) | undefined;
    vi.mocked(startDictation).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button"));

    const { onProgress } = vi.mocked(startDictation).mock.calls[0][0];
    act(() => onProgress?.(12_000_000, undefined));

    // The button has no text of its own any more, so the progress has to
    // reach a screen reader through the label or it reaches nobody.
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Loading the dictation model 12 MB",
      ),
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-dictation-phase",
      "loading",
    );

    release?.({ stop: stopFn });
  });

  it("shows the same wording in the tooltip as in the accessible name", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.hover(screen.getByRole("button"));

    expect(
      await screen.findByRole("tooltip", { name: "Dictate the search query" }),
    ).toBeInTheDocument();
  });

  it("does not take the focus off the field it fills", async () => {
    const user = userEvent.setup();
    const { container } = renderButton();
    const field = document.createElement("textarea");
    container.appendChild(field);
    field.focus();

    await user.click(screen.getByRole("button"));

    // A blur here drops the caret the transcript is appended next to, and on
    // a phone it closes the on-screen keyboard mid-sentence.
    expect(document.activeElement).toBe(field);
  });
});

describe("the disabled prop", () => {
  it("does not start a session while the field is disabled", async () => {
    const user = userEvent.setup();
    renderButton({ disabled: true });

    const button = screen.getByRole("button", {
      name: "Dictate the search query",
    });
    expect(button).toBeDisabled();

    await user.click(button);

    expect(startDictation).not.toHaveBeenCalled();
  });

  it("stops a running session when the field becomes disabled", async () => {
    const user = userEvent.setup();
    const { rerender } = renderButton();

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    // Disabling only blocks the next press. Without the stop, the transcript
    // keeps landing in a field the user can no longer correct.
    rerender(
      <MantineProvider>
        <DictationButton
          getValue={() => ""}
          setValue={() => {}}
          labelScope="the search query"
          disabled
        />
      </MantineProvider>,
    );

    await waitFor(() => expect(stopFn).toHaveBeenCalledTimes(1));
  });
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
  const getValue = () => value;
  const setValue = (text: string) => {
    value = text;
  };
  let onTranscript: (text: string) => void = () => {};

  vi.mocked(startDictation).mockImplementation(async (callbacks) => {
    onTranscript = callbacks.onTranscript;
    return { stop: stopFn };
  });

  const user = userEvent.setup();
  renderButton({ getValue, setValue });

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

  it("does not adopt a load an earlier press abandoned", async () => {
    const user = userEvent.setup();
    const { settingsPubSub } = await import("@/modules/pubSub");
    const firstStop = vi.fn().mockResolvedValue(undefined);
    const secondStop = vi.fn().mockResolvedValue(undefined);
    const releases: ((session: { stop: () => Promise<void> }) => void)[] = [];
    vi.mocked(startDictation).mockImplementation(
      () => new Promise((resolve) => releases.push(resolve)),
    );

    renderButton();
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(1));

    try {
      settingsPubSub[0]({
        ...(settingsPubSub[2]?.() ?? {}),
        enableDictation: false,
      });
      await waitFor(() =>
        expect(screen.queryByRole("button")).not.toBeInTheDocument(),
      );
      settingsPubSub[0]({
        ...(settingsPubSub[2]?.() ?? {}),
        enableDictation: true,
      });

      await user.click(await screen.findByRole("button"));
      await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(2));

      releases[0]({ stop: firstStop });
      releases[1]({ stop: secondStop });

      // The first load lost its UI when the setting went off. Adopting it here
      // leaves its microphone and worker running for the life of the page,
      // because the second press overwrites the ref that would stop it.
      await waitFor(() => expect(firstStop).toHaveBeenCalledTimes(1));
      expect(secondStop).not.toHaveBeenCalled();
    } finally {
      settingsPubSub[0]({
        ...(settingsPubSub[2]?.() ?? {}),
        enableDictation: true,
      });
    }
  });

  it("leaves the recording state quietly when the engine ends on its own", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(startDictation).toHaveBeenCalledTimes(1));

    const { onEnd } = vi.mocked(startDictation).mock.calls[0][0];
    onEnd?.();

    // The recognizer stopping itself is not a failure, but the button has to
    // come back or it sits on "Listening" with nothing behind it.
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Dictate the search query",
      ),
    );
    expect(stopFn).toHaveBeenCalledTimes(1);
    expect(notifications.show).not.toHaveBeenCalled();
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
