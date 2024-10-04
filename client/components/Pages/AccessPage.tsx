import { FormEvent, useState } from "react";
import { TextInput, Button, Stack, Container, Title } from "@mantine/core";
import { addLogEntry } from "../../modules/logEntries";
import { validateAccessKey } from "../../modules/accessKey";

export default function AccessPage({
  onAccessKeyValid,
}: {
  onAccessKeyValid: () => void;
}) {
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    setError("");
    try {
      const isValid = await validateAccessKey(accessKey);
      if (isValid) {
        addLogEntry("Valid access key entered");
        onAccessKeyValid();
      } else {
        setError("Invalid access key");
        addLogEntry("Invalid access key attempt");
      }
    } catch (error) {
      setError("Error validating access key");
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
              value={accessKey}
              onChange={({ target }) => setAccessKey(target.value)}
              placeholder="Enter your access key to continue"
              required
              autoFocus
              error={error}
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
