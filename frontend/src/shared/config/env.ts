export function getApiBase(): string {
  const env = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  if (env && typeof env === "string" && env.length > 0) return env;
  return `http://${window.location.hostname}:8080`;
}

export function getWsUrl(): string {
  const env = (import.meta as any).env?.VITE_WS_URL as string | undefined;
  if (env && typeof env === "string" && env.length > 0) return env;

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:8080/ws`;
}
