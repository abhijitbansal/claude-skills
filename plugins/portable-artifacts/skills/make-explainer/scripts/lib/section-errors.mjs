// Errors a section's prepare step reports. Paths are relative to the section
// ("diagram.nodes[0].label"); the page builder adds the section's own path.
export class SectionErrors extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    this.name = 'SectionErrors';
    this.errors = errors;
  }
}
