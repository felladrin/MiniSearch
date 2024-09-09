import { Modal, Table, Pagination, Message, Button, Stack } from "rsuite";
import { usePubSub } from "create-pubsub/react";
import { logEntriesPubSub } from "../../../../../../../modules/logEntries";
import { useState } from "react";

export function LogsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [logEntries] = usePubSub(logEntriesPubSub);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(10);
  const [page, setPage] = useState(1);

  const handleChangeLimit = (dataKey: number) => {
    setPage(1);
    setLimit(dataKey);
  };

  const data = logEntries.filter((_, index) => {
    const start = limit * (page - 1);
    const end = start + limit;
    return index >= start && index < end;
  });

  const downloadLogsAsJson = () => {
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
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={"calc(100% - 120px)"}
      onEntered={() => setLoading(false)}
    >
      <Modal.Header>
        <Modal.Title>Logs</Modal.Title>
      </Modal.Header>
      {!loading && (
        <>
          <Message showIcon bordered type="info" style={{ margin: "20px 0 " }}>
            <Stack
              direction="row"
              spacing={16}
              justifyContent="space-between"
              alignItems="center"
            >
              <span>
                These logs are stored only in your browser for private use. They
                are not sent automatically and are only for debugging purposes
                in case you need to{" "}
                <a
                  href="https://github.com/felladrin/MiniSearch/issues/new?labels=bug&template=bug_report.yml"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  report a bug
                </a>
                .
              </span>
              <Button onClick={downloadLogsAsJson}>Download Logs</Button>
            </Stack>
          </Message>
          <Table height={535} data={data} wordWrap="break-word" rowHeight={25}>
            <Table.Column width={200} align="center">
              <Table.HeaderCell>Time</Table.HeaderCell>
              <Table.Cell>
                {(rowData) => (
                  <span>{new Date(rowData.timestamp).toLocaleString()}</span>
                )}
              </Table.Cell>
            </Table.Column>
            <Table.Column flexGrow={1}>
              <Table.HeaderCell>Message</Table.HeaderCell>
              <Table.Cell dataKey="message" />
            </Table.Column>
          </Table>
          <div style={{ padding: 20 }}>
            <Pagination
              prev
              next
              first
              last
              ellipsis
              boundaryLinks
              maxButtons={5}
              size="xs"
              layout={["total", "-", "limit", "|", "pager", "skip"]}
              total={logEntries.length}
              limitOptions={[10, 30, 50]}
              limit={limit}
              activePage={page}
              onChangePage={setPage}
              onChangeLimit={handleChangeLimit}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
