export interface CapturedStream {
  readonly done: Promise<void>;
  read(): Uint8Array;
  isDone(): boolean;
  cancel(): void;
}

/** Collect a bounded prefix while continuing to drain the entire child stream. */
export function captureStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes = 16 * 1024 * 1024,
): CapturedStream {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  const done = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size < maxBytes) {
          const kept = value.subarray(0, maxBytes - size);
          chunks.push(kept.slice());
          size += kept.length;
        }
      }
    } finally {
      finished = true;
      reader.releaseLock();
    }
  })();
  return {
    done,
    read() {
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    },
    isDone: () => finished,
    cancel() {
      try {
        void reader.cancel().catch(() => {});
      } catch { /* The stream may finish between the check and cancel. */ }
    },
  };
}

export async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function signalOwnedProcess(
  child: Deno.ChildProcess,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  if (Deno.build.os === "windows") {
    if (signal === "SIGTERM") {
      try {
        child.kill(signal);
      } catch { /* The child may already have exited. */ }
      return;
    }
    try {
      const taskkill = new Deno.Command("taskkill", {
        args: ["/PID", String(child.pid), "/T", "/F"],
        stdout: "null",
        stderr: "null",
      }).spawn();
      if (!await settleWithin(taskkill.status, 1_000)) {
        try {
          taskkill.kill("SIGKILL");
        } catch { /* taskkill may already have exited. */ }
      }
    } catch { /* taskkill may be unavailable or the tree already exited. */ }
    return;
  }
  try {
    // Detached children own a process group, so descendants are stopped too.
    Deno.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch { /* The process group may already have exited. */ }
  }
}
