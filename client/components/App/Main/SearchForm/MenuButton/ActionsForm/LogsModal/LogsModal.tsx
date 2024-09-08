import { Modal, Table, Divider, Pagination } from "rsuite";
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

  const data = logEntries.filter((_, i) => {
    const start = limit * (page - 1);
    const end = start + limit;
    return i >= start && i < end;
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={"calc(100% - 120px)"}
      onEntered={() => {
        setLoading(false);
      }}
    >
      <Modal.Header>
        <Modal.Title>Logs</Modal.Title>
      </Modal.Header>
      {!loading && (
        <>
          <Divider />
          <Table
            height={400}
            data={data}
            wordWrap="break-word"
            // headerHeight={30}
            rowHeight={25}
          >
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
