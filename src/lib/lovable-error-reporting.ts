// Compatibility export for older imports. Errors stay in the local console.
export function reportLovableError(error: unknown, _context: Record<string, unknown> = {}) {
  console.error(error);
}
