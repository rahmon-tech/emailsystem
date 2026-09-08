export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch("/api/" + path, {
    method: method ?? (body ? "POST" : "GET"),
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          body: body instanceof FormData ? body : JSON.stringify(body),
          headers:
            body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" },
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== "auth/login")
      window.location.replace(new URL("/login",window.location.origin).href);
    throw new Error(
      data.fields
        ?.map(
          (f: { path: string; message: string }) => `${f.path}: ${f.message}`,
        )
        .join("; ") ||
        data.error ||
        "Request failed.",
    );
  }
  return data as T;
}
export const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString() : "—";
