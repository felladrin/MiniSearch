import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoadingModelContent from "./LoadingModelContent";

function renderContent(props: {
  modelLoadingProgress: number;
  modelSizeInMegabytes: number;
}) {
  return render(
    <MantineProvider>
      <LoadingModelContent {...props} />
    </MantineProvider>,
  );
}

describe("LoadingModelContent", () => {
  it("omits the size while it is still unknown, keeping the percentage", () => {
    renderContent({ modelLoadingProgress: 70, modelSizeInMegabytes: 0 });

    expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
    expect(screen.getByText("70.0%")).toBeInTheDocument();
  });

  it("shows how much of the model was downloaded once the size is known", () => {
    renderContent({ modelLoadingProgress: 70, modelSizeInMegabytes: 250 });

    expect(screen.getByText("175 MB / 250 MB")).toBeInTheDocument();
    expect(screen.getByText("70.0%")).toBeInTheDocument();
  });
});
