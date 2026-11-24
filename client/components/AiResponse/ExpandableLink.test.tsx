import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExpandableLink from "./ExpandableLink";

/**
 * Tracking ResizeObserver stub: records every instance ever constructed and the
 * union of observed targets, so tests can assert the component shares a single
 * observer across all mounted links.
 */
const createdObservers: FakeResizeObserver[] = [];
const observedTargets = new Set<Element>();

class FakeResizeObserver {
  constructor(_callback: ResizeObserverCallback) {
    createdObservers.push(this);
  }

  observe = vi.fn((target: Element) => {
    observedTargets.add(target);
  });

  unobserve = vi.fn((target: Element) => {
    observedTargets.delete(target);
  });

  disconnect = vi.fn(() => {
    observedTargets.clear();
  });
}

function renderLink(label = "Example Domain", href = "https://example.com") {
  return render(
    <MantineProvider>
      <ExpandableLink href={href}>{label}</ExpandableLink>
    </MantineProvider>,
  );
}

function getPill() {
  const pill = screen
    .getByRole("link")
    .querySelectorAll<HTMLElement>('[aria-hidden="true"]');
  expect(pill).toHaveLength(1);
  return pill[0];
}

function getFullText() {
  return screen.getByTestId("expandable-link-full");
}

describe("ExpandableLink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    observedTargets.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts expanded and auto-collapses after 3 s", () => {
    renderLink();

    expect(getFullText()).toHaveStyle({ opacity: 1 });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(getFullText()).toHaveStyle({ opacity: 0 });
  });

  it("expands on mouseenter", () => {
    renderLink();
    const link = screen.getByRole("link");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.mouseEnter(link);

    expect(getFullText()).toHaveStyle({ opacity: 1 });
  });

  it("expands on focus", () => {
    renderLink();
    const link = screen.getByRole("link");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.focus(link);

    expect(getFullText()).toHaveStyle({ opacity: 1 });
  });

  it("re-collapses 3 s after mouseleave", () => {
    renderLink();
    const link = screen.getByRole("link");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.mouseEnter(link);
    fireEvent.mouseLeave(link);

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(getFullText()).toHaveStyle({ opacity: 1 });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getFullText()).toHaveStyle({ opacity: 0 });
  });

  it("cancels the pending auto-collapse while hovered", () => {
    renderLink();
    const link = screen.getByRole("link");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.mouseEnter(link);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // No timer is pending while hovered, so it must stay expanded.
    expect(getFullText()).toHaveStyle({ opacity: 1 });
  });

  it("shares one ResizeObserver across all links and drops every target on unmount", () => {
    const view = render(
      <MantineProvider>
        {["Alpha", "Beta", "Gamma"].map((label) => (
          <ExpandableLink
            key={label}
            href={`https://example.com/${label.toLowerCase()}`}
          >
            {label}
          </ExpandableLink>
        ))}
      </MantineProvider>,
    );

    expect(createdObservers).toHaveLength(1);
    expect(observedTargets).toHaveLength(3);
    for (const overlay of screen.getAllByTestId("expandable-link-full")) {
      expect(observedTargets.has(overlay)).toBe(true);
    }

    view.unmount();
    expect(observedTargets).toHaveLength(0);
    renderLink();
    expect(createdObservers).toHaveLength(1);
    expect(observedTargets).toHaveLength(1);
  });

  it("animates only transform and opacity", () => {
    renderLink();
    const link = screen.getByRole("link");

    const transitions = [link, ...link.querySelectorAll<HTMLElement>("*")]
      .map((element) => element.style.transition)
      .filter((transition) => transition.length > 0);

    expect(transitions.length).toBeGreaterThan(0);
    for (const transition of transitions) {
      const properties = transition
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0]);
      expect(
        properties.every(
          (property) => property === "transform" || property === "opacity",
        ),
      ).toBe(true);
    }
  });

  it("degrades gracefully when ResizeObserver is missing", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    expect(() => renderLink()).not.toThrow();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com",
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(getFullText()).toHaveStyle({ opacity: 0 });
  });

  it("keeps the full text accessible while visually collapsed", () => {
    renderLink();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "nofollow noopener noreferrer");
    expect(link).toHaveAccessibleName("Example Domain");

    // Opacity-only hiding: never `visibility: hidden`, which would remove the
    // full text from assistive tech.
    const fullText = getFullText();
    expect(fullText).toHaveTextContent("Example Domain");
    expect(fullText.style.visibility).not.toBe("hidden");
  });

  it("shows the first character of plain link text in the pill", () => {
    renderLink("Example Domain");

    expect(getPill().textContent).toBe("E");
  });

  it("shows the first visible character of formatted link text in the pill", () => {
    render(
      <MantineProvider>
        <ExpandableLink href="https://www.reuters.com/">
          <strong>Reuters</strong>
        </ExpandableLink>
      </MantineProvider>,
    );

    expect(getPill().textContent).toBe("R");
  });

  it.each([
    ["😀 Emoji Site", "😀"],
    ["🇨🇭 Swiss Site", "🇨🇭"],
    ["👩‍💻 Dev Site", "👩‍💻"],
  ])("keeps the leading emoji of %s whole in the pill", (label, expected) => {
    renderLink(label);

    expect(getPill().textContent).toBe(expected);
  });

  it("falls back to the first code point without Intl.Segmenter", () => {
    vi.stubGlobal(
      "Intl",
      Object.assign(Object.create(Intl), { Segmenter: undefined }),
    );

    renderLink("😀 Emoji Site");

    expect(getPill().textContent).toBe("😀");
  });
});
