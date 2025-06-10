import { Button } from "@mantine/core";
import type { MantineTheme } from "@mantine/core";
import React from "react";

interface ExpandableLinkProps {
  href: string;
  children: React.ReactNode;
}

export default function ExpandableLink({
  href,
  children,
}: ExpandableLinkProps) {
  const childContent = children?.toString() || "";
  const firstChar = childContent.charAt(0);
  const [isHovered, setIsHovered] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timerRef.current = window.setTimeout(() => {
      setIsHovered(false);
      timerRef.current = null;
    }, 3000);
  };

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const fullTextRef = React.useRef<HTMLDivElement>(null);
  const [fullTextWidth, setFullTextWidth] = React.useState(0);

  React.useEffect(() => {
    const measureText = () => {
      if (fullTextRef.current) {
        setFullTextWidth(fullTextRef.current.scrollWidth);
      }
    };

    measureText();

    window.addEventListener("resize", measureText);
    return () => {
      window.removeEventListener("resize", measureText);
    };
  }, []);

  return (
    <Button
      component="a"
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      variant="light"
      color="gray"
      size="compact-xs"
      radius="xl"
      style={(theme: MantineTheme) => ({
        textDecoration: "none",
        transform: "translateY(-2px)",
        overflow: "hidden",
        position: "relative",
        width: isHovered ? `${fullTextWidth + theme.spacing.md}px` : "2em",
        transition: "width 0.3s ease-in-out",
        textAlign: "center",
      })}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: isHovered ? 0 : 1,
          transition: "opacity 0.2s ease-in-out",
        }}
      >
        {firstChar}
      </span>
      <span
        ref={fullTextRef}
        style={{
          opacity: isHovered ? 1 : 0,
          transition: "opacity 0.3s ease-in-out",
          visibility: isHovered ? "visible" : "hidden",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          position: "relative",
        }}
      >
        {children}
      </span>
    </Button>
  );
}
