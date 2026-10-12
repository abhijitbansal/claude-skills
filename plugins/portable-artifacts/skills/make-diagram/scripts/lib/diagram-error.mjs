// Thrown by buildDiagram when a spec cannot be built.
/** A spec that cannot be built; `errors` is the list of { path, message }. */
export class DiagramError extends Error {
  constructor(errors) {
    super(`diagram spec cannot be built:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
    this.name = 'DiagramError';
    this.errors = errors;
  }
}
