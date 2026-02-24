import type { PropsWithChildren } from "react";

/**
 * Global app providers (placeholders).
 * Keep this component even if currently empty: later we can add QueryClient, Theme, etc.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return <>{children}</>;
}
