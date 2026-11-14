import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, type RenderHookOptions } from "@testing-library/react";

import { queryClient } from "./query.ts";

/**
 * Renders a hook inside the app's Query client, as `main.tsx` does. Tests
 * that use it run in jsdom (`// @vitest-environment jsdom`) and clear the
 * client between tests.
 */
export function renderWithQuery<Result, Props>(
  hook: (props: Props) => Result,
  options?: RenderHookOptions<Props>,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { ...options, wrapper });
}
