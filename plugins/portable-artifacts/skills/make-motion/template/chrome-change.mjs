// The server builds the favicon and provenance footer from the spec's `generatedBy` and `theme` when it
// serves the page. A live reload only remounts the stage, so when either changes the page must reload.
const key = (spec) => JSON.stringify([spec?.generatedBy ?? null, spec?.theme ?? null]);

export const chromeChanged = (prev, next) => key(prev) !== key(next);
