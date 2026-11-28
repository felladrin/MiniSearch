import { MantineProvider } from "@mantine/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchForm from "@/components/Search/Form/SearchForm";
import { ENTER_TO_SUBMIT_CASES } from "@/enterToSubmitCases";
import { resetHandledQuery } from "@/modules/autoSearch";
import { settingsPubSub } from "@/modules/pubSub";
import { getRandomQuerySuggestion } from "@/modules/querySuggestions";
import { defaultSettings } from "@/modules/settings";
import { getDictationEngine, startDictation } from "@/modules/speechToText";
import { searchAndRespond } from "@/modules/textGeneration";

vi.mock("create-pubsub/react", () => ({
  usePubSub: vi.fn((pubSub: unknown) => {
    if (!Array.isArray(pubSub)) {
      return [undefined, vi.fn()];
    }

    const maybeFactory = pubSub[2];
    if (typeof maybeFactory !== "function") {
      return [undefined, vi.fn()];
    }

    return [maybeFactory() ?? undefined, vi.fn()];
  }),
}));

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", vi.fn()]),
}));

vi.mock("../../../hooks/useSearchHistory", () => ({
  useSearchHistory: vi.fn(() => ({
    addToHistory: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useHistoryRestore", () => ({
  useHistoryRestore: vi.fn(() => ({
    restoreSearch: vi.fn(),
  })),
}));

vi.mock("../History/HistoryButton", () => ({
  default: function HistoryButton() {
    return null;
  },
}));

vi.mock("../../../modules/textGeneration", () => ({
  searchAndRespond: vi.fn(),
}));

vi.mock("../../../modules/querySuggestions", () => ({
  DEFAULT_QUERY_SUGGESTION: "Anything you need!",
  getRandomQuerySuggestion: vi.fn(async () => "Anything you need!"),
}));

vi.mock("@/modules/speechToText", async () =>
  (await import("@/testMocks")).speechToTextMock(),
);

/** Captures the props while still exercising the real button lifecycle. */
let dictationProps: {
  getValue: () => string;
  setValue: (value: string) => void;
  labelScope: string;
} = { getValue: () => "", setValue: () => {}, labelScope: "" };

vi.mock("@/components/DictationButton", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/DictationButton")>();
  const DictationButton = actual.default;
  return {
    ...actual,
    default: function DictationButtonProbe(props: typeof dictationProps) {
      dictationProps = props;
      return <DictationButton {...props} />;
    },
  };
});

const renderSearchForm = (
  query: string,
  updateQuery: (query: string) => void,
) => {
  return render(
    <MantineProvider>
      <SearchForm query={query} updateQuery={updateQuery} />
    </MantineProvider>,
  );
};

const waitForPlaceholder = async () => {
  const textarea = await screen.findByRole("textbox");
  await waitFor(() => {
    expect(textarea).toHaveAttribute("placeholder", "Anything you need!");
  });
  return textarea;
};

describe("SearchForm component", () => {
  beforeEach(() => {
    vi.mocked(getDictationEngine).mockReturnValue("wasm");
    vi.mocked(startDictation).mockReset();
    vi.mocked(searchAndRespond).mockClear();
    resetHandledQuery();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    settingsPubSub[0]({ ...defaultSettings });
  });

  it("renders textarea with placeholder when empty", async () => {
    const mockUpdate = vi.fn();
    renderSearchForm("", mockUpdate);
    await waitForPlaceholder();
  });

  it("offers the five time ranges in the button row", async () => {
    // Mantine scrolls the selected option into view, which jsdom does not have.
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    renderSearchForm("hello", vi.fn());
    await screen.findByRole("textbox");

    const timeRange = screen.getByRole("combobox", { name: /time range/i });
    expect(timeRange).toHaveValue("Anytime");

    await user.click(timeRange);

    expect(
      screen
        .getAllByRole("option", { hidden: true })
        .map((option) => option.textContent),
    ).toEqual(["Anytime", "Past day", "Past week", "Past month", "Past year"]);
  });

  describe("the suggestion for an emptied field", () => {
    it("is taken once when the last character is deleted", async () => {
      const user = userEvent.setup();
      renderSearchForm("a", vi.fn());
      const textarea = await screen.findByRole("textbox");
      vi.mocked(getRandomQuerySuggestion).mockClear();

      await user.type(textarea, "{Backspace}");
      await act(async () => {});

      expect(getRandomQuerySuggestion).toHaveBeenCalledTimes(1);
    });

    it("is taken once when Clear is clicked", async () => {
      const user = userEvent.setup();
      renderSearchForm("hello", vi.fn());
      await screen.findByRole("textbox");
      vi.mocked(getRandomQuerySuggestion).mockClear();

      await user.click(screen.getByRole("button", { name: "Clear" }));
      await act(async () => {});

      expect(getRandomQuerySuggestion).toHaveBeenCalledTimes(1);
    });

    it("is dropped when the field was filled again before it arrived", async () => {
      let deliver: (suggestion: string) => void = () => {};
      vi.mocked(getRandomQuerySuggestion)
        .mockImplementationOnce(
          () => new Promise((resolve) => (deliver = resolve)),
        )
        .mockImplementationOnce(() => new Promise(() => {}));
      const user = userEvent.setup();
      renderSearchForm("a", vi.fn());
      const textarea = await screen.findByRole("textbox");

      await user.type(textarea, "{Backspace}b{Backspace}");
      await act(async () => deliver("a late suggestion"));

      expect(textarea).toHaveAttribute("placeholder", "Anything you need!");
    });
  });

  describe("Enter and Shift+Enter", () => {
    it.each(ENTER_TO_SUBMIT_CASES)(
      "with enterToSubmit %s, pressing %s submits: %s",
      async (enterToSubmit, keys, submits) => {
        settingsPubSub[0]({ ...defaultSettings, enterToSubmit });
        const mockUpdate = vi.fn();
        const user = userEvent.setup();
        renderSearchForm("", mockUpdate);

        const textarea = await waitForPlaceholder();
        await user.type(textarea, "test query");
        await user.keyboard(keys);

        if (submits) {
          expect(mockUpdate).toHaveBeenCalledWith("test query");
        } else {
          expect(mockUpdate).not.toHaveBeenCalled();
        }
      },
    );
  });

  it("calls updateQuery on submit", async () => {
    const mockUpdate = vi.fn();
    const user = userEvent.setup();
    renderSearchForm("", mockUpdate);

    const textarea = await waitForPlaceholder();
    await user.type(textarea, "test query");
    const button = screen.getByRole("button", { name: "Search" });
    await user.click(button);

    expect(mockUpdate).toHaveBeenCalledWith("test query");
  });

  it.each([
    { engine: "wasm", submitWith: "Search" },
    { engine: "wasm", submitWith: "Enter" },
    { engine: "web-speech", submitWith: "Search" },
    { engine: "web-speech", submitWith: "Enter" },
  ] as const)(
    "cancels $engine dictation on $submitWith and allows a new session",
    async ({ engine, submitWith }) => {
      const preferLocalModel = engine === "wasm";
      settingsPubSub[0]({
        ...defaultSettings,
        enableLocalDictationModel: preferLocalModel,
      });
      vi.mocked(getDictationEngine).mockReturnValue(engine);
      const cancel = vi.fn();
      const stop = vi.fn();
      vi.mocked(startDictation)
        .mockResolvedValueOnce({ cancel, stop })
        .mockResolvedValueOnce({ cancel: vi.fn(), stop: vi.fn() });
      const user = userEvent.setup();
      const updateQuery = vi.fn();
      renderSearchForm("existing query", updateQuery);
      const textarea = screen.getByRole("textbox");

      await user.click(
        screen.getByRole("button", { name: "Dictate the search query" }),
      );
      await screen.findByRole("button", {
        name: "Stop dictating the search query",
      });
      const [firstSession, firstPreference] =
        vi.mocked(startDictation).mock.calls[0];
      expect(firstPreference).toBe(preferLocalModel);

      if (submitWith === "Enter") {
        await user.type(textarea, "{Enter}");
      } else {
        await user.click(screen.getByRole("button", { name: "Search" }));
      }

      expect(updateQuery).toHaveBeenCalledWith("existing query");
      act(() => {
        if (cancel.mock.calls.length === 0) {
          firstSession.onTranscript("late words");
        }
      });
      expect(textarea).toHaveValue("existing query");
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stop).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).toBe(textarea);

      await user.click(
        screen.getByRole("button", { name: "Dictate the search query" }),
      );
      await screen.findByRole("button", {
        name: "Stop dictating the search query",
      });
      expect(startDictation).toHaveBeenCalledTimes(2);
      const [secondSession] = vi.mocked(startDictation).mock.calls[1];
      act(() => secondSession.onTranscript("fresh words"));
      expect(textarea).toHaveValue("existing query fresh words");
    },
  );

  it("does not re-trigger the search when the form remounts for the same query", async () => {
    window.history.replaceState({}, "", "/?q=remount-case");
    const { unmount } = renderSearchForm("remount case", vi.fn());
    await waitFor(() => expect(searchAndRespond).toHaveBeenCalledTimes(1));

    unmount();
    renderSearchForm("remount case", vi.fn());
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toBeInTheDocument(),
    );

    expect(searchAndRespond).toHaveBeenCalledTimes(1);
  });

  it("runs the search only once when the url query has surrounding whitespace", async () => {
    window.history.replaceState({}, "", "/?q=whitespace-case+");
    renderSearchForm("whitespace case ", vi.fn());
    await waitFor(() => expect(searchAndRespond).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(searchAndRespond).toHaveBeenCalledTimes(1);
  });

  it("floats the dictation button inside the field, not in the button row", async () => {
    renderSearchForm("", vi.fn());
    const textarea = await waitForPlaceholder();
    const dictationButton = screen.getByRole("button", {
      name: "Dictate the search query",
    });

    // The button is anchored to the field, so it cannot drift when the row of
    // buttons below the field changes.
    const fieldWrapper = dictationButton.parentElement;
    expect(fieldWrapper).toContainElement(textarea);
    expect(fieldWrapper).toHaveStyle({ position: "relative" });

    const buttonRow = screen
      .getByRole("button", { name: "Search" })
      .closest("div");
    expect(buttonRow).not.toContainElement(dictationButton);
  });

  it("names the search query in the dictation label", async () => {
    renderSearchForm("", vi.fn());
    await waitForPlaceholder();

    // e2e/smoke.spec.ts anchors its Search-button lookup on this label also
    // containing "search"; losing the word silently weakens that anchor.
    expect(dictationProps.labelScope).toBe("the search query");
  });

  it("reads back what dictation last wrote before the DOM catches up", async () => {
    renderSearchForm("", vi.fn());
    const textarea = await waitForPlaceholder();
    const { getValue, setValue } = dictationProps;

    // The button strips the transcript it inserted last out of whatever it
    // reads back before appending the newer one. A read that misses the write
    // it just made makes that strip miss, and the whole transcript lands on
    // top of itself, once per pause.
    setValue("hello there");
    expect(getValue()).toBe("hello there");

    await act(async () => {});
    expect(textarea).toHaveValue("hello there");

    // Typing is the user's, so the field goes back to reading the DOM.
    await userEvent.type(textarea, " friend");
    expect(getValue()).toBe("hello there friend");
  });
});
