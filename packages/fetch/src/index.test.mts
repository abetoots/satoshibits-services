import { describe, expect, it, vi } from "vitest";

import { fetchFactory } from "./index.mjs";

describe("fetchFactory", () => {
  it("should handle network errors with onFetchError handler", async () => {
    const onFetchError = vi.fn();
    const fetchWithHandlers = fetchFactory({
      errorHandlers: { onFetchError },
    });

    global.fetch = vi.fn(() => Promise.reject(new Error("Network Error")));

    const result = await fetchWithHandlers("/test");

    expect(onFetchError).toHaveBeenCalled();
    expect(result.type).toBe("fetch");
  });

  it("should handle HTTP status errors with onStatusError handler", async () => {
    const onStatusError = vi.fn();
    const fetchWithHandlers = fetchFactory({
      errorHandlers: { onStatusError },
    });

    global.fetch = vi.fn(() => {
      const response = new Response(null, { status: 500 });
      return Promise.resolve(response);
    });

    const result = await fetchWithHandlers("/test");

    expect(onStatusError).toHaveBeenCalled();
    expect(result.type).toBe("status");
  });

  it("should handle JSON parsing errors with onSyntaxError handler", async () => {
    const onSyntaxError = vi.fn();
    const fetchWithHandlers = fetchFactory({
      errorHandlers: { onSyntaxError },
    });

    global.fetch = vi.fn(() => {
      const response = new Response("invalid json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      return Promise.resolve(response);
    });

    const result = await fetchWithHandlers("/test");

    expect(onSyntaxError).toHaveBeenCalled();
    expect(result.type).toBe("syntax");
  });

  it("should handle fetch abort errors with onAbortError handler", async () => {
    const onAbortError = vi.fn();
    const fetchWithHandlers = fetchFactory({
      errorHandlers: { onAbortError },
    });

    global.fetch = vi.fn(() =>
      Promise.reject(new DOMException("Aborted", "AbortError")),
    );

    const result = await fetchWithHandlers("/test");

    expect(onAbortError).toHaveBeenCalled();
    expect(result.type).toBe("abort");
  });

  it("should retry on retriable status codes", async () => {
    const fetchWithHandlers = fetchFactory({
      errorHandlers: {},
      retriableStatusCodes: [500],
      maxRetries: 2,
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "success" }),
      });

    const result = await fetchWithHandlers("/test");

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.type).toBe("success");
    expect(result.data).toEqual({ data: "success" });
  });
});
