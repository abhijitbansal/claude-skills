// Inline script text must not close its tag or open an HTML comment. Every script the page builder inlines goes
// through this one escape.
export const inlineCode = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('<!--', '<\\!--');
