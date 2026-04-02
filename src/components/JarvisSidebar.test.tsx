import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/JarvisSidebar";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

function renderSidebar(collapsed = false, onCollapsedChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar
        active="dashboard"
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe("Sidebar collapse controls", () => {
  it("renders expanded navigation labels and requests collapse", () => {
    const onCollapsedChange = vi.fn();
    renderSidebar(false, onCollapsedChange);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("renders collapsed state with compact branding and requests expansion", () => {
    const onCollapsedChange = vi.fn();
    renderSidebar(true, onCollapsedChange);

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("J")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });
});
