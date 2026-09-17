import { Button } from "@mantine/core";
import React from "react";

interface ExpandableLinkProps {
  href: string;
  children: React.ReactNode;
}

/** Gap kept between the expanded overlay and the viewport edge before flipping. */
const VIEWPORT_EDGE_MARGIN = 8;

/**
 * One module-level ResizeObserver shared by every mounted ExpandableLink:
 * a 30-link answer used to register 30 window listeners, each forcing a
 * `scrollWidth` read. The registry maps each observed element to its callback,
 * and each link unregisters itself on unmount.
 */
const resizeCallbacks = new Map<Element, () => void>();
let sharedObserver: ResizeObserver | null = null;

/**
 * Lazily creates the shared observer, or returns null when the environment has
 * no `ResizeObserver` (e.g. jsdom) so callers can degrade to a one-shot measure.
 */
function getSharedObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") {
    return null;
  }
  if (!sharedObserver) {
    sharedObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        resizeCallbacks.get(entry.target)?.();
      }
    });
  }
  return sharedObserver;
}

/**
 * Registers `onResize` with the shared observer for `element` and returns an
 * unregister function. The observer instance used at registration is captured,
 * so cleanup is correct even if the global disappears in between.
 */
function registerResizeListener(
  element: Element,
  onResize: () => void,
): () => void {
  const observer = getSharedObserver();
  resizeCallbacks.set(element, onResize);
  observer?.observe(element);

  return () => {
    resizeCallbacks.delete(element);
    observer?.unobserve(element);
  };
}

/**
 * Citation link that collapses to a first-character pill and reveals the full
 * link text on hover/focus, auto-collapsing after 3 s.
 *
 * The reveal is an absolutely positioned overlay with its own pill background,
 * so the anchor keeps a fixed collapsed width in layout and the animation only
 * touches `transform` and `opacity` — compositor-only, no per-frame layout.
 * The full text always stays in the DOM (opacity only, never `visibility`), so
 * assistive tech always reads the complete link.
 */
export default function ExpandableLink({
  href,
  children,
}: ExpandableLinkProps) {
  const childContent = children?.toString() || "";
  const firstChar = childContent.charAt(0);
  const [isExpanded, setIsExpanded] = React.useState(true);
  const timerRef = React.useRef<number | null>(null);
  const anchorRef = React.useRef<HTMLAnchorElement>(null);
  const fullTextRef = React.useRef<HTMLSpanElement>(null);
  const [expandLeftward, setExpandLeftward] = React.useState(false);

  React.useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      setIsExpanded(false);
      timerRef.current = null;
    }, 3000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    timerRef.current = window.setTimeout(() => {
      setIsExpanded(false);
      timerRef.current = null;
    }, 3000);
  };

  React.useEffect(() => {
    const textElement = fullTextRef.current;
    const anchorElement = anchorRef.current;
    if (!textElement || !anchorElement) {
      return;
    }

    const measure = () => {
      // The overlay is shrink-to-fit, so its scrollWidth is the full text width.
      // The flip decision uses the anchor's viewport position (stable regardless
      // of which side the overlay is currently anchored to) so a link near the
      // right edge reveals leftward instead of overflowing the viewport.
      const fullTextWidth = textElement.scrollWidth;
      const { left } = anchorElement.getBoundingClientRect();
      setExpandLeftward(
        left + fullTextWidth > window.innerWidth - VIEWPORT_EDGE_MARGIN,
      );
    };

    // Measure once even when ResizeObserver is missing, so the flip state is set.
    measure();
    return registerResizeListener(textElement, measure);
  }, []);

  // Slide the overlay in from the pill side it grows out of.
  const collapsedSlide = expandLeftward
    ? "translateX(8px)"
    : "translateX(-8px)";

  return (
    <Button
      ref={anchorRef}
      component="a"
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      variant="light"
      color="gray"
      size="compact-xs"
      radius="xl"
      style={{
        textDecoration: "none",
        transform: "translateY(-2px)",
        // Fixed collapsed width: the reveal is an overlay, so expanding never
        // changes layout and never pushes neighbouring text around.
        width: "2em",
        overflow: "visible",
        position: "relative",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: isExpanded ? 0 : 1,
          transition: "opacity 0.2s ease-in-out",
          pointerEvents: "none",
        }}
      >
        {firstChar}
      </span>
      <span
        ref={fullTextRef}
        data-testid="expandable-link-full"
        style={{
          position: "absolute",
          top: 0,
          ...(expandLeftward ? { right: 0 } : { left: 0 }),
          height: "100%",
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          paddingInline: "0.75em",
          borderRadius: "var(--mantine-radius-xl)",
          background: "var(--mantine-color-gray-light)",
          color: "var(--mantine-color-gray-light-color)",
          boxShadow: "var(--mantine-shadow-md)",
          opacity: isExpanded ? 1 : 0,
          transform: isExpanded ? "translateX(0)" : collapsedSlide,
          transition: "opacity 0.3s ease-in-out, transform 0.3s ease-in-out",
          // While collapsed the overlay is invisible but still covers neighbouring
          // text; keep pointer events on the pill only.
          pointerEvents: isExpanded ? "auto" : "none",
        }}
      >
        {children}
      </span>
    </Button>
  );
}
