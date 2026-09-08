# DSDS authoring style guide

The schema doesn't enforce field order — YAML/JSON Schema has no concept of
it, and `npm run validate` will happily accept a document with every field
shuffled. This guide is a second, human-facing layer on top of the schema:
a single, predictable order for the fields the schema *does* allow in any
order, so that every DSDS document in this repo (and, ideally, in yours)
reads the same way regardless of who wrote it.

This isn't optional polish. A predictable order means:

- **A reader can skim.** Once you know `sourceFiles` always comes before
  `sections` and `sections` always comes before `traits`, you can jump
  straight to the part of a component you care about without re-learning
  the document's shape every time.
- **Diffs stay small.** Two people adding a `combos` entry to the same file
  shouldn't produce a diff that also reshuffles four unrelated fields.
- **Generated tooling has one shape to target.** A codegen script, a
  linter, or an agent writing a new entry has one canonical order to
  produce, not "whatever order felt right that day."

None of this is enforced by `npm run check:all` today — it's a convention,
not a schema rule. See [Tooling](#tooling) at the end for why, and what
could change that.

---

## 1. Entry-level field order

### The general principle

Fields fall into six bands, always in this order:

1. **Identity** — what this thing *is*: `id`, `kind`, `name`, `description`,
   `purpose`, plus any kind-specific field that's really just a more
   specific answer to "what is this" (a token's `tokenType`, a theme's
   `colorScheme`). These are the fields you'd read first to know whether
   you're even looking at the right entry.
2. **Metadata** — `metadata`. Facts *about* the entry (status, ownership,
   tags) rather than facts that define it.
3. **Primary content pointer** — a component's `sourceFiles`, a token's
   `source`. The thing everything else is a fact *about*. Comes right
   after metadata because it's the closest thing to a second identity
   field: "here's the real artifact this entry documents."
4. **Documentation** — `sections`. The narrative: guidelines, definitions,
   steps. See [§2](#2-section-order-within-sections) for how to order what's
   inside it.
5. **Structured facts** — the machine-checkable shape of the artifact:
   a component's `specs`, `imports`, `traits`, `combos`; a token's
   `combos`. These come *after* `sections`, not before, because they're
   closer to code than to prose — read the human-facing story first, then
   the structured facts a tool would actually parse.
6. **Relationships and escape hatches** — `related`, `extends`, `refs`,
   always in that order, then `$extensions` last, always. `$extensions` is
   last on every object in this schema, not just entries — it's the
   "everything else" bucket, and reads better positioned as such.

Why `tokenType`/`colorScheme` land in band 1 (before `metadata`) while
`sourceFiles` lands in band 3 (after `metadata`): a token's type is as
fundamental to what the token *is* as its `kind` — "this is a color
token" is an identity fact, not a supporting one. A component's
`sourceFiles`, by contrast, is where the *implementation* lives, which is
a level removed from identity — you know it's a component named "Button"
before you know or care which file it's built from.

### Component

```
id
kind
name
description
purpose
metadata
sourceFiles
sections
specs
imports
traits
combos
related
extends
refs
$extensions
```

### Token

```
id
kind
name
description
purpose
tokenType
source
metadata
sections
combos
related
extends
refs
$extensions
```

### Theme

```
id
kind
name
description
purpose
colorScheme
source
metadata
sections
related
extends
refs
$extensions
```

### System

```
id
kind
name
description
purpose
metadata
sections
related
extends
refs
$extensions
```

### Generic `entry` (and a namespaced custom kind)

```
id
kind
name
description
purpose
metadata
sections
related
extends
refs
$extensions
```

Only include a field if the entry actually uses it — this is an order for
whichever fields are present, not a mandate to write every field out.
`kind: component` with no `traits` just skips straight from `sections` to
`related` (or wherever the next present field is).

### Base documents

A base document (one with `schemaVersion`) follows the same
identity-then-content-then-relationships shape, at the document level:

```
schemaVersion
$schema
name
entries
shared
refs
$extensions
```

### Shared entries

A `shared` entry has no `kind`, `purpose`, `extends`, or `related` (see
`shared.schema.yaml`'s own `$comment` for why) — its order is the same
shape with those omitted:

```
id
name
description
metadata
sections
refs
$extensions
```

---

## 2. Section order, within `sections[]`

### Group by kind first

If an entry has more than one section, **every section of the same kind
sits together** — all `guidelines` sections as a contiguous run, then all
`definitions` sections, then all `steps` sections, then any generic
`section`s. Never interleave: `guidelines`, `definitions`, `guidelines` is
wrong even if that was the order the ideas came to you in while writing.

### Kind order: general to specific

When more than one kind is present, order the kinds themselves
general-to-specific:

1. **`guidelines`** — the broadest question ("should I even use this, and
   how do I use it correctly") comes first.
2. **`definitions`** — reference material: anatomy, terms, a glossary.
   More specific than guidelines (it's about *this entry's* parts and
   vocabulary specifically), less specific than a procedure.
3. **`steps`** — a concrete procedure or checklist. The most specific of
   the three structured kinds — one exact sequence, not general guidance.
4. **`section`** (generic) — freeform prose that didn't fit the other
   three. Last, because it's the fallback, not a first-class kind on equal
   footing with the others.

### Within `guidelines`: when-to-use, then how-to-use, then tag-specific

A component or pattern commonly has more than one `guidelines` section.
Order them:

1. **`framing: when-to-use`** — the fit judgment: should you reach for
   this at all. The most general question there is.
2. **`framing: how-to-use`** (or no `framing`, which defaults to
   `how-to-use`) covering the entry broadly — general implementation
   rules that apply everywhere.
3. **`for: all`, then `for: human`, then `for: agent`**
4. **Tag-scoped `guidelines` sections** — a section whose items all carry
   the same `metadata.tags`/item-level `tags` entry (for example, a
   section that's really just the accessibility rules, or just the
   mobile-specific ones). Most specific, so it goes last. Order multiple
   tag-scoped sections alphabetically by their tag unless there's an
   obvious narrative reason not to (for example, accessibility rules
   conventionally lead, since they're rarely truly optional in practice).

```yaml
sections:
  - kind: guidelines
    for: all
    framing: when-to-use
    items: [...]

  - kind: guidelines
    for: all
    items: [...]                    # framing: how-to-use (default)

  - kind: guidelines
    for: all
    title: Accessibility
    items: [...]                    # every item here tagged "accessibility"

  - kind: definitions
    context: anatomy
    items: [...]

  - kind: steps
    title: Migration
    items: [...]
```

---

## 3. Guideline item order, within one section

Order items by `level`, strongest-and-most-common first, in this exact
sequence:

```
must
should
may
should-not
must-not
```

This isn't RFC 2119's own presentation order (which pairs `must`/`must-not`
and `should`/`should-not`) — it reads as a spectrum from "always do this"
to "never do this," with the two conditional/softer levels (`should`,
`may`) in the middle, rather than alternating strong/weak. A reader
scanning top-to-bottom sees the non-negotiable rules first and the hard
prohibitions last, with the judgment calls in between.

Within one level, keep items in whatever order tells the best story
(usually authoring order) — this guide doesn't mandate a secondary sort.
Don't reorder same-level items just to alphabetize them; that usually
makes a guidelines section read worse, not better.

```yaml
items:
  - statement: Use semantic tokens instead of raw values.
    level: must
  - statement: Prefer the `primary` variant for the page's one main action.
    level: should
  - statement: Add a leading icon when it disambiguates the action.
    level: may
  - statement: Should not pair `loading` with `disabled` in the same interaction.
    level: should-not
  - statement: Never stack two primary-variant buttons in the same view.
    level: must-not
```

---

## 4. Field order inside common item shapes

The same "identity, then content, then relationships, then `$extensions`"
logic applies one level down, inside the objects `sections[].items[]`
holds. These follow the schema files' own declared property order
directly — nothing to redesign, just keep it:

**A section itself** (any kind): `kind`, `for`, `title`, `description`,
`context`, `metadata`, `items`, `freeform`, `$extensions`.

**A `guidelines` item**: `id`, `statement`, `level`, `example`,
`alternatives`, `evidence`, `related`, `checks`, `checkedBy`, `tags`,
`refs`, `$extensions`.

**A `definitions` item**: `id`, `term`, `definition`, `usage`, `aliases`,
`$extensions`.

**A `steps` item**: `id`, `title`, `description`, `checks`, `refs`,
`examples`, `optional`, `$extensions`.

**A `ref`** (object form): `to`/`href`, `rel`, `role`, `note`. Note this
is *not* the order `common/ref.schema.yaml` declares its own properties
in (the schema lists `rel` first) — putting `to`/`href` first reads
better in practice ("what does this point at" before "what kind of
pointer is it"), and every example in this repo already does it this way.
This guide follows established practice here rather than the schema
file's internal declaration order.

**A `combo`**: `subject`, `items`, `level`, `note` — matches
`common/combo.schema.yaml`'s own declared order.

---

## 5. A complete example

```yaml
id: badge
kind: component
name: Badge
description: A small status indicator, attached to another element.
purpose: Draws attention to a count, state, or category without interrupting the layout it's attached to.
metadata:
  status: {status: stable}
  since: 1.2.0
  tags: [status, indicator, count]
sourceFiles:
  - platform: react
    file: ./src/Badge.tsx
sections:
  - kind: guidelines
    for: all
    framing: when-to-use
    items:
      - statement: Use to surface a count or state on another element (a notification count, an unread indicator).
        level: should
      - statement: Do not use as a replacement for a full status message a user needs to act on.
        level: should-not

  - kind: guidelines
    for: all
    items:
      - statement: Keep label text to a single word or number.
        level: must
      - statement: Pair with an accessible label when the badge conveys meaning color alone cannot.
        level: must
      - statement: Prefer the `dot` variant when the exact count isn't meaningful to the user.
        level: should

  - kind: guidelines
    for: all
    title: Accessibility
    items:
      - statement: Expose the badge's content to assistive technology even when visually decorative.
        level: must

  - kind: definitions
    for: all
    context: anatomy
    items:
      - term: Dot
        definition: The minimal variant with no visible label, just a colored indicator.

specs:
  - href: ./contracts/badge.contract.json
    rel: contract
traits:
  - kind: enum
    id: variant
    description: Which visual form the badge takes.
    values:
      - id: count
        description: Shows a numeric value.
      - id: dot
        description: Shows no value, just presence.
combos:
  - subject: variant.dot
    level: must-not
    items: [variant.count]
    note: A badge is either a dot or a count, never both at once.
related:
  - to: avatar
    rel: pairs-with
refs:
  - href: https://github.com/org/ds/react/badge
    rel: source
```

---

## Tooling

Nothing in `npm run check:all` enforces this guide today — it's a
convention for humans and agents writing DSDS documents by hand, not a
rule the schema or validator knows about. A future `scripts/validate/lint-docs.js`
rule (run via `npm run lint`) could assert compliance the same way the
[advisory lint tier](https://designsystemdocspec.org/conformance#enforcement-tiers)
checks documentation quality — reordering keys isn't something a document
should ever fail `npm run check:all` over, but it's exactly the kind of
thing the advisory tier exists for. Not built yet; a reasonable next step
if drift becomes a real problem instead of a hypothetical one.
