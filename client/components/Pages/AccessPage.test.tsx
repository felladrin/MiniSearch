import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type AccessKeyResult, validateAccessKey } from "@/modules/accessKey";
import AccessPage from "./AccessPage";

vi.mock("@/modules/accessKey", () => ({
  validateAccessKey: vi.fn(),
}));

vi.mock("@/modules/logEntries", () => ({
  addLogEntry: vi.fn(),
}));

async function submitKey(result: AccessKeyResult) {
  vi.mocked(validateAccessKey).mockResolvedValueOnce(result);
  const onAccessKeyValid = vi.fn();
  const user = userEvent.setup();
  render(
    <MantineProvider>
      <AccessPage onAccessKeyValid={onAccessKeyValid} />
    </MantineProvider>,
  );

  await user.type(
    screen.getByPlaceholderText("Enter your access key to continue"),
    "some-key{Enter}",
  );

  return onAccessKeyValid;
}

describe("AccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says the key is wrong when the server rejects it", async () => {
    await submitKey("invalid");

    expect(await screen.findByText("Invalid access key")).toBeInTheDocument();
  });

  it("says the server could not be reached instead of blaming the key", async () => {
    await submitKey("unreachable");

    expect(
      await screen.findByText("Could not reach the server. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Invalid access key")).toBeNull();
  });

  it("shows no field error when rate-limited", async () => {
    const onAccessKeyValid = await submitKey("rateLimited");

    expect(screen.queryByText("Invalid access key")).toBeNull();
    expect(onAccessKeyValid).not.toHaveBeenCalled();
  });

  it("lets the user in with a valid key", async () => {
    const onAccessKeyValid = await submitKey("valid");

    expect(onAccessKeyValid).toHaveBeenCalled();
  });
});
