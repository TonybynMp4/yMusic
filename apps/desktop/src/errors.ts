/** The message of a thrown value: an Error's own message, anything else as a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
