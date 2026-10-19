// A problem with the scene's content (not a bug): errors are [{ path, message }], like the validator's.
// Its own module so the lifts can throw it without importing api.mjs (which imports them).
export class SceneError extends Error {
  constructor(errors) {
    super(errors[0].message);
    this.name = 'SceneError';
    this.errors = errors;
  }
}
