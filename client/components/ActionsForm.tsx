import { Tooltip } from "react-tooltip";
import toast from "react-hot-toast";

export function ActionsForm() {
  const handleClearDataButtonClick = async () => {
    const sureToDelete = self.confirm(
      "Are you sure you want to reset the settings and delete all files in cache?",
    );

    if (!sureToDelete) return;

    toast.loading("Clearing data...", {
      id: "clear-data-toast",
      position: "bottom-center",
    });

    self.localStorage.clear();

    for (const cacheName of await self.caches.keys()) {
      await self.caches.delete(cacheName);
    }

    for (const databaseInfo of await self.indexedDB.databases()) {
      if (databaseInfo.name) self.indexedDB.deleteDatabase(databaseInfo.name);
    }

    toast.dismiss("clear-data-toast");

    toast.success("Data cleared!", {
      position: "bottom-center",
    });

    self.location.reload();
  };

  return (
    <div>
      <div
        style={{
          textAlign: "center",
          fontSize: "16px",
          fontWeight: "bolder",
          margin: "10px",
        }}
      >
        Actions
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: "8px",
        }}
      >
        <Tooltip
          id="clear-data-button"
          place="top-start"
          variant="info"
          style={{ maxWidth: "90vw" }}
        />
        <button
          style={{ fontSize: "small" }}
          onClick={handleClearDataButtonClick}
          data-tooltip-id="clear-data-button"
          data-tooltip-content="Reset settings and delete all files in cache to free up space."
        >
          Clear Data
        </button>
      </div>
    </div>
  );
}
