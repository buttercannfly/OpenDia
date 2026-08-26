import { beforeEach, describe, expect, it, vi } from "vitest";
import { CdpCommander, rejectPendingCommands } from "./cdp-commander";

describe("CdpCommander", () => {
  let commandCallback: ((result?: unknown) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    commandCallback = undefined;
    global.chrome = {
      debugger: {
        sendCommand: vi.fn((_target, _command, _params, callback) => {
          commandCallback = callback as (result?: unknown) => void;
        }),
      },
      runtime: { lastError: undefined },
    } as unknown as typeof chrome;
  });

  it("rejects a pending CDP command when its signal is aborted", async () => {
    const controller = new AbortController();
    const pending = new CdpCommander(1, controller.signal).sendCommand(
      "Accessibility.getFullAXTree",
      {},
    );
    controller.abort(new Error("cancel CDP"));

    await expect(pending).rejects.toThrow("cancel CDP");
    expect(() => commandCallback?.({ nodes: [] })).not.toThrow();
  });

  it("rejects commands when debugger cleanup starts", async () => {
    const pending = new CdpCommander(2).sendCommand("DOM.enable", {});
    rejectPendingCommands(2, "Debugger detaching");

    await expect(pending).rejects.toThrow(
      "CDP command 'DOM.enable' aborted: Debugger detaching",
    );
  });

  it("cleans up a command after its own timeout", async () => {
    const pending = new CdpCommander(3).sendCommand("DOM.getDocument", {}, 50);
    const assertion = expect(pending).rejects.toThrow("timed out after 50ms");
    await vi.advanceTimersByTimeAsync(50);
    await assertion;

    expect(() => rejectPendingCommands(3, "late cleanup")).not.toThrow();
  });
});
