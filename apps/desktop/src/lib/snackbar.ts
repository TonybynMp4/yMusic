import { Toast } from "@base-ui/react/toast";

/** How long a snackbar with nothing to press stays up. */
export const SNACKBAR_MS = 4000;
/** Long enough to read the message and reach the button. */
export const SNACKBAR_ACTION_MS = 6000;

export interface SnackbarAction {
  label: string;
  onClick: () => void;
}

export interface SnackbarOptions {
  message: string;
  /** At most one, as in YouTube Music. Pressing it also closes the snackbar. */
  action?: SnackbarAction | undefined;
  /** Overrides the default for the snackbar's kind. */
  timeout?: number | undefined;
  /** Announced at once rather than politely, for failures. */
  urgent?: boolean | undefined;
  /** When the snackbar goes for any reason: its time ran out, it was replaced, or its action was pressed. */
  onClose?: (() => void) | undefined;
}

/**
 * The app's one toast manager. Held at module level so code outside React,
 * and hooks with no provider in reach, can show a snackbar too.
 */
export const snackbarManager = Toast.createToastManager();

/**
 * Shows a snackbar, replacing whichever one is up: YouTube Music shows one
 * at a time, the newest. Returns its id, for `closeSnackbar`.
 */
export function showSnackbar(options: SnackbarOptions): string {
  snackbarManager.close();
  const { action } = options;
  const id = snackbarManager.add({
    title: options.message,
    timeout: options.timeout ?? (action ? SNACKBAR_ACTION_MS : SNACKBAR_MS),
    priority: options.urgent ? "high" : "low",
    onClose: options.onClose,
    actionProps: action && {
      children: action.label,
      onClick: () => {
        snackbarManager.close(id);
        action.onClick();
      },
    },
  });
  return id;
}

export function closeSnackbar(id: string): void {
  snackbarManager.close(id);
}
