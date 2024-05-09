import { useState } from "react";
import { SettingsForm } from "./SettingsForm";
import { toast } from "react-hot-toast";

export function SettingsButton() {
  const [isToastOpen, setToastOpen] = useState(false);

  const toastId = "settings-toast";

  const openToast = () => {
    setToastOpen(true);

    toast(
      <div>
        <SettingsForm />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "8px",
          }}
        >
          <button style={{ fontSize: "small" }} onClick={closeToast}>
            Done
          </button>
        </div>
      </div>,
      {
        id: toastId,
        duration: Infinity,
        position: "bottom-center",
        style: {
          borderRadius: "10px",
          background: "var(--background)",
          color: "var(--text-main)",
        },
      },
    );
  };

  const closeToast = () => {
    setToastOpen(false);
    toast.dismiss(toastId);
  };

  return (
    <button
      style={{ fontSize: "small", marginRight: 0 }}
      onClick={(event) => {
        event.preventDefault();
        isToastOpen ? closeToast() : openToast();
      }}
    >
      Settings
    </button>
  );
}
