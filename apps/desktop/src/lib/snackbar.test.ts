import { describe, expect, it, vi } from "vitest";

import {
  SNACKBAR_ACTION_MS,
  SNACKBAR_MS,
  showSnackbar,
  snackbarManager,
} from "./snackbar.ts";

interface Event {
  action: string;
  options: {
    id?: string;
    timeout?: number;
    priority?: string;
    actionProps?: { children: string; onClick: () => void };
  };
}

function record(): Event[] {
  const events: Event[] = [];
  snackbarManager[" subscribe"]((event) => events.push(event as Event));
  return events;
}

describe("showSnackbar", () => {
  it("closes whatever is up before showing the new one", () => {
    const events = record();
    const id = showSnackbar({ message: "Added to queue" });
    expect(events.map((e) => e.action)).toEqual(["close", "add"]);
    expect(events[0]!.options.id).toBeUndefined();
    expect(events[1]!.options.id).toBe(id);
  });

  it("gives one with an action longer to read", () => {
    const events = record();
    showSnackbar({ message: "Saved" });
    showSnackbar({ message: "Couldn't play", action: { label: "Retry", onClick: () => {} } });
    showSnackbar({ message: "Gone", action: { label: "Skip", onClick: () => {} }, timeout: 1000 });
    const timeouts = events.filter((e) => e.action === "add").map((e) => e.options.timeout);
    expect(timeouts).toEqual([SNACKBAR_MS, SNACKBAR_ACTION_MS, 1000]);
  });

  it("closes the snackbar when its action is pressed, then runs it", () => {
    const events = record();
    const onClick = vi.fn<() => void>();
    const id = showSnackbar({ message: "Couldn't play", urgent: true, action: { label: "Retry", onClick } });
    const added = events.find((e) => e.action === "add")!;
    expect(added.options.priority).toBe("high");
    expect(added.options.actionProps?.children).toBe("Retry");
    events.length = 0;
    added.options.actionProps!.onClick();
    expect(events).toEqual([{ action: "close", options: { id } }]);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
