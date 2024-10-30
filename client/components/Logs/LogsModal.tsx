import {
  Alert,
  Button,
  Center,
  Group,
  Modal,
  Pagination,
  Table,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { useCallback, useMemo, useState } from "react";
import { logEntriesPubSub } from "../../modules/logEntries";

export default function LogsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const [logEntries] = usePubSub(logEntriesPubSub);

  const [page, setPage] = useState(1);

  const logEntriesPerPage = 5;

  const logEntriesFromCurrentPage = useMemo(
    () =>
      logEntries.slice(
        (page - 1) * logEntriesPerPage,
        page * logEntriesPerPage,
      ),
    [logEntries, page],
  );

  const downloadLogsAsJson = useCallback(() => {
    const jsonString = JSON.stringify(logEntries, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "logs.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [logEntries]);

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="Logs">
      <Alert variant="light" color="blue" icon={<IconInfoCircle />} mb="md">
        <Group justify="space-between" align="center">
          <span>
            This information is stored solely in your browser for personal use.
            It isn't sent automatically and is retained for debugging purposes
            should you need to{" "}
            <a
              href="https://github.com/felladrin/MiniSearch/issues/new?labels=bug&template=bug_report.yml"
              target="_blank"
              rel="noopener noreferrer"
            >
              report a bug
            </a>
            .
          </span>
          <Button onClick={downloadLogsAsJson} size="xs" data-autofocus>
            Download Logs
          </Button>
        </Group>
      </Alert>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Time</Table.Th>
            <Table.Th>Message</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {logEntriesFromCurrentPage.map((entry, index) => (
            <Table.Tr key={`${entry.timestamp}-${index}`}>
              <Table.Td>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </Table.Td>
              <Table.Td>{entry.message}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Center>
        <Pagination
          total={Math.ceil(logEntries.length / logEntriesPerPage)}
          value={page}
          onChange={setPage}
          size="sm"
          mt="md"
        />
      </Center>
    </Modal>
  );
}
