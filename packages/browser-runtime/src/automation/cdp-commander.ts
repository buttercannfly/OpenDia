/**
 * Chrome DevTools Protocol Commander
 *
 * Provides type-safe wrapper for chrome.debugger.sendCommand with timeout handling
 */

const DEFAULT_CDP_TIMEOUT = 10000;

const pendingCommands = new Map<
  number,
  Set<{ abort: (error: Error) => void; command: string }>
>();

export function rejectPendingCommands(tabId: number, reason: string): void {
  const pending = pendingCommands.get(tabId);
  if (pending) {
    for (const { abort, command } of [...pending]) {
      abort(new Error(`CDP command '${command}' aborted: ${reason}`));
    }
    pendingCommands.delete(tabId);
  }
}

export class CdpCommander {
  constructor(
    readonly tabId: number,
    private readonly signal?: AbortSignal,
  ) {}

  async sendCommand<T = unknown>(
    command: string,
    params: Record<string, unknown>,
    timeout: number = DEFAULT_CDP_TIMEOUT,
    signal: AbortSignal | undefined = this.signal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", handleAbort);
        const pending = pendingCommands.get(this.tabId);
        pending?.delete(pendingEntry);
        if (pending?.size === 0) pendingCommands.delete(this.tabId);
      };
      const rejectCommand = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const handleAbort = () => {
        rejectCommand(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error(`CDP command '${command}' aborted`),
        );
      };
      const pendingEntry = { abort: rejectCommand, command };

      timeoutId = setTimeout(() => {
        rejectCommand(
          new Error(`CDP command '${command}' timed out after ${timeout}ms`),
        );
      }, timeout);

      if (!pendingCommands.has(this.tabId)) {
        pendingCommands.set(this.tabId, new Set());
      }
      pendingCommands.get(this.tabId)!.add(pendingEntry);
      signal?.addEventListener("abort", handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }

      chrome.debugger.sendCommand(
        { tabId: this.tabId },
        command,
        params,
        (result) => {
          const lastError = chrome.runtime.lastError;
          if (settled) return;
          settled = true;
          cleanup();
          if (lastError) {
            reject(
              new Error(
                `Failed to send CDP command '${command}': ${lastError.message}`,
              ),
            );
          } else {
            resolve(result as T);
          }
        },
      );
    });
  }
}
