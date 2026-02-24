import { useEffect, useRef } from "react";

export function useInterval(cb: () => void, delayMs: number | null) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (delayMs == null) return;

    const t = window.setInterval(() => cbRef.current(), delayMs);
    return () => window.clearInterval(t);
  }, [delayMs]);
}
