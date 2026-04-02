import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CVStatusBar } from "@/components/CVStatusBar";
import { fetchLatestCV, uploadCV, type CVLatestResponse } from "@/lib/api";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchLatestCV: vi.fn(),
    uploadCV: vi.fn(),
  };
});

const fetchLatestCVMock = vi.mocked(fetchLatestCV);
const uploadCVMock = vi.mocked(uploadCV);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderStatusBar() {
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CVStatusBar />
    </QueryClientProvider>
  );

  return { ...view, queryClient };
}

const noCvResponse: CVLatestResponse = {
  has_cv: false,
  status: "no_cv",
  parsed_json: {},
  suggestions: [],
};

describe("CVStatusBar upload flows", () => {
  beforeEach(() => {
    localStorage.clear();
    toastMock.mockReset();
    fetchLatestCVMock.mockReset();
    uploadCVMock.mockReset();
    fetchLatestCVMock.mockResolvedValue(noCvResponse);
  });

  it("persists the uploaded filename after a successful upload", async () => {
    fetchLatestCVMock
      .mockResolvedValueOnce(noCvResponse)
      .mockResolvedValue({
        has_cv: true,
        status: "ready",
        readiness: { dashboard: true, scoring: true, parsed_payload: true, raw_text: true },
        parsed_json: { summary: "New summary", skills: ["TypeScript"] },
        suggestions: [],
      });
    uploadCVMock.mockResolvedValue(undefined);

    renderStatusBar();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["resume"], "new-resume.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadCVMock).toHaveBeenCalledWith(file);
    });

    expect(await screen.findByText("CV ready")).toBeInTheDocument();
    expect(screen.getByText("Uploaded CV")).toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith({ title: "CV uploaded successfully" });
  });

  it("restores the previous filename when upload fails", async () => {
    localStorage.setItem("jarvis_cv_name", "existing-resume.pdf");
    fetchLatestCVMock.mockResolvedValue({
      has_cv: true,
      status: "ready",
      readiness: { dashboard: true, scoring: true, parsed_payload: true, raw_text: true },
      parsed_json: { summary: "Existing summary", skills: ["React"] },
      suggestions: [],
    });
    uploadCVMock.mockRejectedValue(new Error("Only PDF CV uploads are supported"));

    renderStatusBar();

    await screen.findByText("existing-resume.pdf");

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["bad"], "broken.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadCVMock).toHaveBeenCalledWith(file);
    });

    await waitFor(() => {
      expect(localStorage.getItem("jarvis_cv_name")).toBe("existing-resume.pdf");
    });

    expect(toastMock).toHaveBeenCalledWith({
      title: "CV upload failed",
      description: "Only PDF CV uploads are supported",
      variant: "destructive",
    });
  });
});
