# Node kinds, shapes and icons

Shape encodes kind, so colour is never the only signal. Most kinds have a default icon (the tables below say which); set `icon` to override it. The first kind listed for a type is its default.

## architecture

| kind | shape | default icon |
|---|---|---|
| `service` | rounded rectangle | `lucide:server` |
| `client` | rounded rectangle | `lucide:monitor` |
| `user` | rounded rectangle | `lucide:user` |
| `database` | cylinder | `lucide:database` |
| `storage` | cylinder | `lucide:hard-drive` |
| `queue` | stacked rectangle | `lucide:layers` |
| `cache` | rounded rectangle | `lucide:zap` |
| `function` | rounded rectangle | `lucide:square-function` |
| `gateway` | hexagon-cut rectangle | `lucide:door-open` |
| `external` | dashed rounded rectangle | `lucide:cloud` |
| `other` | rounded rectangle | `lucide:box` |

Use `external` for things you do not run (a payment provider), `gateway` for the entry point, `storage` for blob or file stores and `database` for queryable data.

## flow

| kind | shape | default icon |
|---|---|---|
| `step` | rectangle | none |
| `start`, `end` | stadium (pill) | none |
| `decision` | diamond | none |
| `io` | parallelogram | `lucide:arrow-right-left` |
| `subprocess` | rectangle with double side bars | `lucide:workflow` |
| `wait` | rounded rectangle | `lucide:clock` |

A `decision` has two or more outgoing edges, each labelled with its answer ("yes", "no").

## state

| kind | shape | default icon |
|---|---|---|
| `state` | rounded rectangle | none |
| `start` | filled dot | none |
| `end` | ringed dot | none |
| `choice` | small diamond | none |

For a dot or a choice the label sits beside the shape.

## sequence (participants)

| kind | shape | default icon |
|---|---|---|
| `service` | rounded rectangle | `lucide:server` |
| `actor` | rounded rectangle | `lucide:user` |
| `database` | cylinder | `lucide:database` |
| `queue` | stacked rectangle | `lucide:layers` |
| `external` | dashed rounded rectangle | `lucide:cloud` |

Message kinds: `sync` (solid, filled arrow), `async` (solid, open arrow), `reply` (dashed, open arrow), `self` (a loop on one participant).

## Icons

`icon` is `lucide:<name>` (306 general icons) or `brand:<slug>` (126 software brands, CC0 marks). Brand marks are drawn monochrome in the text colour, never in brand colours. Names come from committed catalogs; an unknown name fails validation with a did-you-mean.

```
node scripts/icons.mjs search database      # lucide:database, lucide:database-backup, ...
node scripts/icons.mjs search postgres      # brand:postgresql
node scripts/icons.mjs list brand           # every brand ref
node scripts/icons.mjs list                 # both catalogs
```

Refs are printed best match first, one per line. A search with no match prints nothing; use a kind's default icon then. An `icon` on a kind drawn as a bare shape (flow `start`, `end`, `decision`; state `start`, `end`, `choice`) is an error: `kind "decision" is drawn as a shape without an icon; remove icon or use kind "step"`.
