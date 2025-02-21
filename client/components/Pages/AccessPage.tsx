import { Button, Container, Stack, TextInput, Title } from "@mantine/core";
import { type FormEvent, useState } from "react";
import { validateAccessKey } from "../../modules/accessKey";
import { addLogEntry } from "../../modules/logEntries";

interface AccessPageState {
  accessKey: string;
  error: string;
}

export default function AccessPage({
  onAccessKeyValid,
}: {
  onAccessKeyValid: () => void;
}) {
  const [state, setState] = useState<AccessPageState>({
    accessKey: "",
    error: "",
  });

  const handleSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const isValid = await validateAccessKey(state.accessKey);
      if (isValid) {
        addLogEntry("Valid access key entered");
        onAccessKeyValid();
      } else {
        setState((prev) => ({ ...prev, error: "Invalid access key" }));
        addLogEntry("Invalid access key attempt");
      }
    } catch (error) {
      setState((prev) => ({ ...prev, error: "Error validating access key" }));
      addLogEntry(`Error validating access key: ${error}`);
    }
  };

  return (
    <Container size="xs">
      <Stack p="lg" mih="100vh" justify="center">
        <Title order={2} ta="center">
          Access Restricted
        </Title>
        <form onSubmit={handleSubmit}>
          <Stack gap="xs">
            <TextInput
              value={state.accessKey}
              onChange={({ target }) =>
                setState((prev) => ({ ...prev, accessKey: target.value }))
              }
              placeholder="Enter your access key to continue"
              required
              autoFocus
              error={state.error}
              styles={{
                input: {
                  textAlign: "center",
                },
              }}
            />
            <Button size="xs" type="submit">
              Submit
            </Button>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
