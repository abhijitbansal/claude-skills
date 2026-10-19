---
name: chrome-form-widgets
description: "form_input says 'Set text value', 'Checkbox checked' or 'ok' but a react-select, Workday dropdown, checkbox or radio did not commit, or errors with 'Element type BUTTON is not a supported form input'. Use when filling any web form through claude-in-chrome, before touching a custom dropdown, checkbox, radio, date or typeahead."
---

# Filling custom form widgets through claude-in-chrome

On any form that submits something, stop before Submit unless the user explicitly asked you to submit. Never type a password, tick a consent or truthfulness box, or click a final Submit, Send or Apply button: hand those to the user.

## Symptom

- A `form_input` result such as `Set text value to "United States" (previous: "")` on a combobox, or `Checkbox checked (previous: false)` on a Workday checkbox, but the field still shows its placeholder, or the form later complains (`The field To is required and must have a value`).
- `actions[0] (form_input) failed: Element type "BUTTON" is not a supported form input` on a Workday dropdown.
- A "Save and Continue" that returns an error banner because it was clicked on an empty step.

## Root cause

`form_input` writes the DOM value of real text inputs, selects and textareas. React-select comboboxes, Workday custom buttons, checkboxes and radios listen for events that it does not fire, yet it can still print a success line. A success line from `form_input` is therefore not evidence for any widget except a plain text, tel, url or textarea input.

## Fix: tool per widget

| Widget | Do | Verify by read-back |
|---|---|---|
| text, tel, url, textarea | `form_input` ref + value, several in one parallel or `browser_batch` call | result echoes `(previous: "")` |
| react-select (Greenhouse) | scroll to it, click the control (by coordinate if click by ref does not open it), screenshot to read options, click the option, or type then Enter | clear (×) icon present, or `find` / `read_page` shows the committed value |
| searchable list (country, phone country) | click control, confirm it opened, type the name, confirm the filtered option, Enter | same as above; check no text landed in a neighbouring field |
| location typeahead | type, wait 2 s, click the suggestion row; typing alone does not commit | field shows the full suggestion text |
| Workday dropdown button | `computer` click the button, type-ahead (`n` for No, `Master`, the first words of the option), Enter. Long lists: `read_page filter=all ref_id=<listbox>` and click the option ref, but listbox refs can be stale after reopening a dropdown, so prefer type-ahead plus Enter and confirm the label with `find` | button label changes (for example `No Required`); use `find` |
| checkbox, radio | `computer` click by ref, never `form_input` | a dependent field appears or disappears (Workday "I currently work here" removes the To date), or `read_page` shows the state |
| MM/YYYY date segments (Workday) | click the segment, `type` digits without slashes (`022019`) | `get_page_text` shows `2/2019` |
| file input | `file_upload` with an absolute path on the real `input[type=file]` ref. On Workday it shows only in `read_page filter=all ref_id=<container>`; the interactive filter lists a decoy button | page text shows the filename or "Successfully Uploaded!" |
| consent, legal, attestation | leave untouched. To learn the options, open, screenshot, press Escape | n/a |

## Rules that prevent the known failures

1. Verify by read-back (`find`, `read_page`, `get_page_text`), not by eyeballing a down-scaled screenshot. If you must use a screenshot, take it at full scale of the area.
2. Do a final sweep before hand-over: scroll to top and `find` any required field still showing `Select...` or empty, including a phone-country flyout and any unlabeled `Country` box.
3. Do not chain a click on the next control behind an option click without a screenshot or read-back between them; coordinates shift after scroll or reflow.
4. Refs are not stable across steps on single-page apps (Workday reuses the same ref for the primary button). After Save and Continue, wait 4 to 5 s and `get_page_text` to read "current step N of M" before any retry.
5. Discovery: `find` caps near 19 matches, so run a second narrower `find`. `read_page filter=interactive` is viewport-scoped.
6. Include `browser_batch` in the first ToolSearch and batch fill, scroll and read sequences. Call `tabs_context_mcp` first, create tabs one at a time, and call it again after any "not in this session's tab group" error; the agent can only drive tabs in its own group.
7. Log only values you read back or the user reported. Mark the rest `assumed`.

## Evidence

- `Element type "BUTTON" is not a supported form input`: a Workday tenant, 2026-10-19, `form_input` on a dropdown button.
- `[form_input] Checkbox checked (previous: false)` on "I currently work here", after which the form still required the To date; a real click committed it and the To field disappeared.
- `Set text value to "United States"` on a Greenhouse Country field; the submission record still asserted that value without a read-back.
- The react-select behaviour on other Greenhouse boards, the Ashby location combobox and the Workday type-ahead recipe come from run notes and were not re-checked line by line.

## Related

`claude-in-chrome` (the browser tools this skill drives). Per-ATS skills in a job-application project should defer widget recipes to this one.
