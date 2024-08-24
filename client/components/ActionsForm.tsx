import { Text, Button, VStack, Message } from "rsuite";
import { useToaster } from "rsuite";

export function ActionsForm() {
  const toaster = useToaster();

  const handleClearDataButtonClick = async () => {
    const sureToDelete = self.confirm(
      "Are you sure you want to reset the settings and delete all files in cache?",
    );

    if (!sureToDelete) return;

    toaster.push(
      <Message showIcon type="info" id="clear-data-toast" closable>
        Clearing data...
      </Message>,
    );

    self.localStorage.clear();

    for (const cacheName of await self.caches.keys()) {
      await self.caches.delete(cacheName);
    }

    for (const databaseInfo of await self.indexedDB.databases()) {
      if (databaseInfo.name) self.indexedDB.deleteDatabase(databaseInfo.name);
    }

    toaster.push(
      <Message
        showIcon
        type="success"
        id="clear-data-toast"
        closable
        onClose={() => self.location.reload()}
      >
        Data cleared!
      </Message>,
    );
  };

  return (
    <VStack>
      <Button size="sm" onClick={handleClearDataButtonClick}>
        Clear all data
      </Button>
      <Text size="sm" muted>
        Reset settings and delete all files in cache to free up space.
      </Text>
    </VStack>
  );
}
