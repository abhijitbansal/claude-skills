# Simple English: the `simple` field

Based on ideas from ASD-STE100. This is not a compliant document, and it does not check the standard's approved dictionary. The rules below are written in our own words.

An explainer can carry two versions of its text. The normal version shows first. A reader who turns on "Simple English" sees the simple version instead. You write both. `validate.mjs` checks the simple one and warns; a warning never stops a build.

## Where it goes

Add `simple` to a section. It is an object that uses the same field names as the section.

```json
{
  "type": "steps",
  "items": [{ "title": "Invoke the migration utility", "text": "The utility must be executed prior to the deploy." }],
  "simple": { "items": [{ "title": "Run the migration tool", "text": "Run it before you deploy." }] }
}
```

Eligible sections: `tldr`, `text`, `cards`, `risks`, `steps`, `timeline`, `compare`, `callout`, `details`, `table`. `simple` on any other section is an error. Code, commands, file paths, numbers, data and every interactive section stay as they are.

What `simple` may hold, per section:

- `tldr`: `title`, `text`, `points`
- `text`, `callout`: `title`, `text`
- `details`: `title`, `summary`, `text`
- `cards`, `steps`, `timeline`: `title`, and `items` with `title` and `text`
- `risks`: `title`, and `items` with `risk` and `mitigation`
- `compare`: `title`, `verdict`, and `columns` with `title` and `points`
- `table`: `title`, `caption`, `columns`, `rows`

Every field is optional. A field you leave out shows its normal text. The section's `label` and `id` do not change.

## How lists match

A list in `simple` matches the normal list by position. The first simple item replaces the first normal item, field by field. To change only the third item, write `{}` for the first two. A simple list that is longer than the normal list is an error.

```json
"items": [{ "title": "Fast" }, { "title": "Cheap" }, { "title": "Safe" }],
"simple": { "items": [{}, {}, { "title": "Has no known faults" }] }
```

## Write it for every eligible section

If one section has simple text, the validator warns about each eligible section that has none. Write a simple version for all of them, or for none.

Simple text does not count toward the page's word limits. Keep the facts the same. Do not add or drop a claim.

## The rules

Each rule shows a before and an after. The validator checks everything in this list. Text inside `backticks` is skipped by every rule.

**1. Keep a sentence to 25 words. In a step, keep it to 20.** Cut it in two.

- Before: `The cache keeps each entry for ten minutes and after that time it deletes the entry and loads a new copy from the database when a reader asks for it.`
- After: `The cache keeps each entry for ten minutes. Then it deletes the entry. The next read loads a new copy from the database.`

**2. Keep a paragraph to 6 sentences.** Start a new paragraph, or use a list.

**3. Use the active voice.** Say who or what does the action. The validator flags likely passive verbs, such as "was deployed" or "is shown".

- Before: `The build was deployed on Monday.`
- After: `The team deployed the build on Monday.`

**4. Do not use semicolons.** Write two sentences.

- Before: `The job runs at night; it needs the lock.`
- After: `The job runs at night. It needs the lock.`

**5. Use the short word.**

| Instead of | Write |
| --- | --- |
| in order to | to |
| utilize | use |
| prior to | before |
| subsequent to | after |
| in the event that | if |
| due to the fact that | because |
| approximately | about |
| numerous | many |
| sufficient | enough |
| commence | start |

- Before: `Wait prior to the restart.`
- After: `Wait before the restart.`

**6. Start each step with a verb.** The step's `title` is the action. The validator refuses a few common openers that are not verbs: the, a, an, this, that, these, those, it, there, we, you, they, he, she, I, and, but, or, so.

- Before: `The server restarts`
- After: `Restart the server`

## Habits the validator cannot check

- Use one word for one thing. If you call it "the cache" once, do not call it "the store" later.
- Put the main point first.
- Prefer a plain verb to a noun built from a verb: "decide", not "make a decision".
- Say the number, not "several".
