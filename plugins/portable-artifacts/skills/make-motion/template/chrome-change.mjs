// The server builds the favicon and provenance footer from the spec's `generatedBy`, `theme` and
// `provenance: false` when it serves the page. A live reload only remounts the stage, so when any changes the page must reload.
const key = (spec) => JSON.stringify([spec?.generatedBy ?? null, spec?.theme ?? null, spec?.provenance === false]);

export const chromeChanged = (prev, next) => key(prev) !== key(next);
