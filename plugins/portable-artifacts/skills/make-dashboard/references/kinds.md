# Chart kinds

A chart is either a **kind** (you name columns, the build writes the Vega-Lite) or raw `vegaLite`. Exactly one of the two per chart.
Kind charts get tooltips, a legend filter or zoom where it makes sense, alternate views, a sortable Table view and an Export menu.

Common keys: `id`, `title`, `query`, `kind`, `width` (`full` | `half`), `format` (`number | currency | percent | compact`, applies to every numeric axis, legend and tooltip), `views`, `pair`.
Role keys name a column of the chart's query: `x`, `y`, `color`, `size`, `value`. Column types: text = nominal, date or timestamp = temporal, number = quantitative.
Write titles that state the finding ("North drives half of revenue"), not the field names.

- `views`: narrows and reorders the alternate views listed per kind below. `"table"` is always last and always there. Naming the kind itself (`"bar"` on a bar) is accepted and ignored.
- `pair: true`: shows the primary view and the next view side by side and forces full width. The left pane stays on the primary view; the right pane has its own tabs over the remaining views, Table included. On a kind with no alternates (`scatter`, `heatmap`), pane 2 shows the Table.
- Order follows the query for text `x` (the build sets `sort: null`), so put `ORDER BY` in the SQL. The `sorted` view sorts descending.
- More than 8 categories, or a label longer than 12 characters, turns bars horizontal.
- `color` allows at most 8 distinct values (3 for `scatter` and `bubble`). Fold the rest into "Other" in SQL.
- A view that the data cannot support (negative values, or a zero total, for `share`, `normalized` and a coloured `area`) is not offered. If you list it in `views` and the query returns rows, that is an error; with zero rows it is silently dropped. `donut` is different: it is an error on its own when it has more than 6 slices or a negative value. So is a `kind: "area"` with `color` and a negative `y` (it stacks): use `line`. A NULL in the `color` column counts as one more value toward the cap.

## bar

Magnitude by category. Roles: `x` (text, or a date shown as bands), `y` (number).
Gets: hover highlight, tooltips.
Views: `sorted`, `share` (needs every `y` >= 0 and a positive total), `table`.

    { "id": "c1", "title": "North drives half of revenue", "query": "by_region",
      "kind": "bar", "x": "region", "y": "revenue", "format": "currency", "views": ["sorted", "table"] }

## stacked-bar

Parts of a whole per category. Roles: `x` (text or date), `y` (number), `color` (text, required).
Gets: legend filter.
Views: `grouped`, `normalized` (100%; needs every `y` >= 0 and a positive total), `table`.

    { "id": "c2", "title": "Q4 growth came from the South", "query": "by_quarter_region",
      "kind": "stacked-bar", "x": "quarter", "y": "revenue", "color": "region" }

## grouped-bar

Compare series side by side. Same roles as `stacked-bar`.
Gets: legend filter.
Views: `stacked`, `normalized` (needs every `y` >= 0 and a positive total), `table`.

    { "id": "c3", "title": "South beats North in three of four quarters", "query": "by_quarter_region",
      "kind": "grouped-bar", "x": "quarter", "y": "revenue", "color": "region", "pair": true }

## line

Change over time. Roles: `x` (date or timestamp, or text in query order), `y` (number), optional `color` (text).
Gets: crosshair on the nearest point, x zoom and pan (date x only; double-click resets), legend filter when `color` is set.
Views: `area` (when `color` is set it needs every `y` >= 0 and a positive total), `table`.

    { "id": "trend", "title": "Revenue up 18% since March", "query": "monthly",
      "kind": "line", "x": "month", "y": "revenue", "color": "region", "format": "currency" }

## area

Same roles, gets and rules as `line`; draws filled areas (stacked when `color` is set).
Views: `line`, `table`.

    { "id": "c4", "title": "Volume doubled in a year", "query": "monthly_units",
      "kind": "area", "x": "month", "y": "units" }

## scatter

Relationship between two numbers. Roles: `x` (number), `y` (number), optional `color` (text, at most 3 values).
Gets: x/y zoom and pan (double-click resets), legend filter when `color` is set.
Views: `table`.

    { "id": "c5", "title": "Bigger deals take longer to close", "query": "deals",
      "kind": "scatter", "x": "days_to_close", "y": "amount" }

## bubble

Scatter with a third number as size. Roles: `x` (number), `y` (number), `size` (number), optional `color` (text, at most 3 values).
Gets: same as `scatter`.
Views: `scatter`, `table`.

    { "id": "c6", "title": "Small accounts carry the margin", "query": "accounts",
      "kind": "bubble", "x": "orders", "y": "margin", "size": "revenue" }

## heatmap

Intensity across two categories or dates. Roles: `x` (text or date), `y` (text or date), `value` (number).
Gets: hover highlight; the colour scale is a sequential ramp.
Views: `table`.

    { "id": "c7", "title": "Weekends are quiet in every region", "query": "by_weekday_region",
      "kind": "heatmap", "x": "weekday", "y": "region", "value": "orders" }

## histogram

Distribution of one number (up to 20 bins). Roles: `value` (number).
Gets: hover highlight.
Views: `boxplot`, `table`.

    { "id": "c8", "title": "Most orders are under 100", "query": "orders",
      "kind": "histogram", "value": "amount" }

## boxplot

Spread of one number, optionally per category. Roles: `value` (number), optional `x` (text).
Gets: tooltips.
Views: `histogram`, `table`.

    { "id": "c9", "title": "Enterprise deals vary the most", "query": "deals",
      "kind": "boxplot", "value": "amount", "x": "segment" }

## donut

Share of a whole. Roles: `x` (text, the slices), `y` (number).
Gets: legend filter.
Availability: at most 6 slices and every `y` >= 0, otherwise it is an error; use `bar` instead.
Views: `bar`, `table`.

    { "id": "c10", "title": "Three products make 80% of units", "query": "units_by_product",
      "kind": "donut", "x": "product", "y": "units", "width": "half" }

## Raw Vega-Lite

Use `vegaLite` (no `kind`) for anything the kinds do not cover: layered or faceted charts, custom marks, annotations.
Write a Vega-Lite spec without `data`; do not set colours, `config`, `width` or `autosize`. See `schema.md`.
It still gets the page theme, tooltips on every mark, the Table view and the Export menu. A legend filter is added only to a unit spec
with a nominal `color`, no `params` of its own and no `opacity` encoding; otherwise zoom is added to a unit spec with point, circle or square marks and no params.
`kind` keys (`x`, `y`, `color`, `size`, `value`, `views`, `format`, `pair`) are errors on a raw chart.

## Errors you may see

    charts[0].y: required for kind "bar" (roles: x, y)
    charts[0].y: "region" is text (VARCHAR); y of kind "bar" needs a numeric column
    charts[0].views[0]: share needs every revenue >= 0 (row 2 has -1)

Others: `kind "bar" has no view "shar"; did you mean "share"? (views: sorted, share, table)`, `use either kind or vegaLite, not both`,
`region has 9 values; line colour allows at most 8 (fold the rest into "Other" in SQL or drop color)`, `donut needs <= 6 slices (region has 7); use kind "bar"`, `x needs kind (raw vegaLite charts ignore it)`.
