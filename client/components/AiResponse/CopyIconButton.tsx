import { ActionIcon, CopyButton, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";

interface CopyIconButtonProps {
  value: string;
  tooltipLabel?: string;
}

export default function CopyIconButton({
  value,
  tooltipLabel = "Copy",
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
            color={copied ? "teal" : "gray"}
            variant="subtle"
            onClick={copy}
          >
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}
