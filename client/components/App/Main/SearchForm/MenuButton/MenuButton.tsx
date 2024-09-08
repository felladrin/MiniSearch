import { useState } from "react";
import { SettingsForm } from "./SettingsForm/SettingsForm";
import { ActionsForm } from "./ActionsForm/ActionsForm";
import {
  Button,
  Drawer,
  Panel,
  PanelGroup,
  IconButton,
  Stack,
  Whisper,
  Tooltip,
} from "rsuite";
import { Icon } from "@rsuite/icons";
import { FaGithub } from "react-icons/fa";
import { repository } from "../../../../../../package.json";
import prettyMilliseconds from "pretty-ms";
import { getSemanticVersion } from "../../../../../modules/stringFormatters";

export function MenuButton() {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const repoName = repository.url.split("/").pop();

  return (
    <>
      <Button
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          if (isDrawerOpen) {
            closeDrawer();
          } else {
            openDrawer();
          }
        }}
      >
        Menu
      </Button>
      <Drawer open={isDrawerOpen} onClose={closeDrawer} size="xs">
        <Drawer.Header>
          <Drawer.Title>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Whisper
                followCursor
                placement="auto"
                speaker={
                  <Tooltip>
                    <Stack direction="column">
                      <span>{repoName}</span>
                      <span>
                        {`v${getSemanticVersion(VITE_BUILD_DATE_TIME)}+${VITE_COMMIT_SHORT_HASH}`}
                      </span>
                      <span>
                        Released{" "}
                        {prettyMilliseconds(
                          new Date().getTime() -
                            new Date(VITE_BUILD_DATE_TIME).getTime(),
                          {
                            compact: true,
                            verbose: true,
                          },
                        )}{" "}
                        ago
                      </span>
                    </Stack>
                  </Tooltip>
                }
              >
                {repoName}
              </Whisper>

              <IconButton
                appearance="subtle"
                href={repository.url}
                target="_blank"
                icon={<Icon as={FaGithub} />}
                circle
              />
            </Stack>
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body style={{ padding: 0 }}>
          <PanelGroup>
            <Panel header="Settings">
              <SettingsForm />
            </Panel>
            <Panel header="Actions">
              <ActionsForm />
            </Panel>
          </PanelGroup>
        </Drawer.Body>
      </Drawer>
    </>
  );
}
