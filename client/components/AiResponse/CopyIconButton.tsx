import { ActionIcon, CopyButton, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface CopyIconButtonProps {
  value: string;
  tooltipLabel?: string;
  /** Shown instead of the copy icon, so two copy buttons side by side differ. */
  icon?: ReactNode;
}

export default function CopyIconButton({
  value,
  tooltipLabel = "Copy",
  icon = <IconCopy size={16} />,
}: CopyIconButtonProps) {
  return (
    <CopyButton value={value} timeout={2000}>
      {({ copied, copy }) => (
        <Tooltip
          label={copied ? "Copied" : tooltipLabel}
          withArrow
          position="right"
        >
          <ActionIcon
            aria-label={tooltipLabel}
            color={copied ? "teal" : "gray"}
            variant="subtle"
            onClick={copy}
          >
            {copied ? <IconCheck size={16} /> : icon}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}
