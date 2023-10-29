import "console-panel/src/console-panel.js";
import "console-panel/src/console-panel.css";

declare const consolePanel: {
  enable: () => void;
  disable: () => void;
};

consolePanel.enable();
