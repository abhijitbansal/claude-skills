// One type scale and one link style for every page. Emitted by themeCss().
export const TYPE_TOKENS = {
  '--fs-xs': '12px', '--fs-sm': '14px', '--fs-base': '17px', '--fs-md': '21px', '--fs-lg': '27px', '--fs-xl': '34px',
  '--fs-hero': 'clamp(40px, 6vw, 60px)', '--lh-body': '1.6', '--lh-head': '1.15', '--lh-hero': '1.05',
  '--track-display': '-0.02em', '--track-hero': '-0.03em',
  // Fluid display sizes (the flavored explainer hero and its section numerals) and one spacing scale.
  '--fs-display': 'clamp(2.5rem, 1.25rem + 4.2vw, 4.75rem)', '--fs-numeral': 'clamp(4.5rem, 2rem + 9vw, 9rem)',
  '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px', '--sp-4': '16px', '--sp-5': '24px', '--sp-6': '32px', '--sp-7': '48px', '--sp-8': '72px', '--sp-9': '112px',
};

const PROSE_LINKS = '.prose a, p a, li a, td a, dd a, figcaption a';

export function typeCss() {
  const tokens = Object.entries(TYPE_TOKENS).map(([k, v]) => `${k}:${v}`).join(';');
  return [
    `:root{${tokens}}`,
    'a{color:var(--accent);text-decoration:none}',
    `${PROSE_LINKS}{text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:0.22em;text-decoration-color:var(--accent)}`,
    `@supports (color: color-mix(in srgb, red, red)){${PROSE_LINKS}{text-decoration-color:color-mix(in srgb, var(--accent) 45%, transparent)}}`,
    `${PROSE_LINKS.split(', ').map((s) => `${s}:hover`).join(', ')}{text-decoration-color:var(--accent)}`,
    ':focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    // :not(text) keeps the small-label class off make-diagram's SVG node labels (<text class="pa-label">), whose size is layout-measured.
    '.pa-label:not(text){font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);font-weight:600}',
  ].join('\n');
}
