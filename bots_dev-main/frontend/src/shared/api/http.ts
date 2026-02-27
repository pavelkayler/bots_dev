async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    try {
      const obj = JSON.parse(text);
      const msg = obj?.message ?? obj?.error ?? "";
      return msg ? ` ${String(msg)}` : ` ${text}`;
    } catch {
      return ` ${text}`;
    }
  } catch {
    return "";
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`GET ${url} failed: ${res.status}${body}`);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const bodyText = await readErrorBody(res);
    throw new Error(`POST ${url} failed: ${res.status}${bodyText}`);
  }
  return (await res.json()) as T;
}

export async function putJson<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const bodyText = await readErrorBody(res);
    throw new Error(`PUT ${url} failed: ${res.status}${bodyText}`);
  }
  return (await res.json()) as T;
}

export async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const bodyText = await readErrorBody(res);
    throw new Error(`DELETE ${url} failed: ${res.status}${bodyText}`);
  }
  return (await res.json()) as T;
}
