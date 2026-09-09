# DSDS authoring style guide

This guide is a set of recommendations on how to order and format the schema to ensure it reads predictably and consistently across documents.  

Note: All rules below are advisory only. The schema will validate if none of these guidelines are filed. `DSDS-17`–`DSDS-20` in the [advisory lint tier](https://designsystemdocspec.org/conformance#enforcement-tiers) report violations under `npm run lint`, and nothing here can fail
`npm run check:all`. See [Tooling](#tooling) at the end for exactly which parts are mechanized and which are left to judgment.

---

## 1. Entry-level field order

### The general principle

Fields fall into six bands, always in this order:

1. **Identity** — what this thing *is*: `id`, `kind`, `name`, `description`,
   `purpose`, plus any kind-specific field that's really just a more
   specific answer to "what is this" (a token's `tokenType` and `source`, a
   theme's `colorScheme` and `source`). These are the fields you'd read
   first to know whether you're even looking at the right entry.
2. **Metadata** — `metadata`. Facts *about* the entry (status, ownership,
   tags) rather than facts that define it.
3. **Primary content pointer** — a component's `sourceFiles`. The thing
   everything else is a fact *about*. Comes right after metadata because
   it's the closest thing to a second identity field: "here's the real
   artifact this entry documents."
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

Why a token's `tokenType`/`source` and a theme's `colorScheme`/`source`
land in band 1 (before `metadata`) while a component's `sourceFiles`
lands in band 3 (after `metadata`): a token's type is as fundamental to
what the token *is* as its `kind` — "this is a color token" is an identity
fact, not a supporting one — and a token entry deliberately carries no
`value`, so its `source` *is* where the thing being documented lives.
Identity and content are the same fact for a token. A component's
`sourceFiles`, by contrast, is where the *implementation* lives, which is
a level removed from identity — you know it's a component named "Button"
before you know or care which file it's built from, and the component
entry carries plenty of its own substance (`traits`, `combos`, `sections`)
that a token entry doesn't.

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

### Within `guidelines`: by specificity, then by audience

A component or pattern commonly has more than one `guidelines` section.
Two sorts apply, in this order: **specificity**, then **audience**.

Specificity, general to specific:

1. **`framing: when-to-use`** — the fit judgment: should you reach for
   this at all. The most general question there is.
2. **`framing: how-to-use`** (or no `framing`, which defaults to
   `how-to-use`) covering the entry broadly — general implementation
   rules that apply everywhere.
3. **Tag-scoped `guidelines` sections** — a section whose items all carry
   the same `metadata.tags`/item-level `tags` entry (for example, a
   section that's really just the accessibility rules, or just the
   mobile-specific ones). Most specific, so it goes last. Order multiple
   tag-scoped sections alphabetically by their tag unless there's an
   obvious narrative reason not to (for example, accessibility rules
   conventionally lead, since they're rarely truly optional in practice).

Audience, broadest readership first:

1. **`for: all`**
2. **`for: human`**
3. **`for: agent`**

`for: all` leads because it's the only value every reader sees. `for:
agent` goes last because it's the narrowest — notes a person never reads,
which by convention extend the human-facing sections above rather than
replacing them.

The two sorts compose in that order: **specificity first, audience
second.** A `for: agent` when-to-use section still precedes a `for: all`
how-to-use one, because specificity decides before audience is consulted.
Audience only settles the order of sections that already tie — same
`framing`, both un-tag-scoped.

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
    for: agent
    items: [...]                    # same framing as above, narrower
                                    # audience — so audience breaks the tie

  - kind: guidelines
    for: all
    title: Accessibility
    items: [...]                    # every item here tagged "accessibility"
                                    # tag-scoped, so it follows every
                                    # how-to-use section regardless of `for`

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

Four rules in the [advisory lint tier](https://designsystemdocspec.org/conformance#enforcement-tiers)
check this guide. They live in `scripts/validate/lint-docs.js`, are
catalogued in `schema/conformance-rules.yaml` with
`enforcement: advisory`, and run under `npm run lint`:

| Rule | Checks | This guide |
|---|---|---|
| `DSDS-17` | An entry's top-level field order | [§1](#1-entry-level-field-order) |
| `DSDS-18` | `sections[]` grouping and kind order | [§2](#2-section-order-within-sections) |
| `DSDS-19` | Guideline item order by `level` | [§3](#3-guideline-item-order-within-one-section) |
| `DSDS-20` | A base document's own field order | [§1 Base documents](#base-documents) |

Reordering keys should never fail `npm run check:all`, and it can't:
advisory rules warn and always exit 0. `lint-docs.js` does fail on
catalog/implementation drift in either direction, so a rule can't be
listed here without an implementation or vice versa.

**Deliberately not mechanized.** One sub-tier of §2's guidelines ordering
is a judgment call a linter would get wrong more often than right, so
`DSDS-18` skips it:

- **Tag-scoped sections.** Deciding that a section "is really just the
  accessibility rules" means reading its items, not its shape — unlike
  `framing` and `for`, which are plain fields. See `DSDS-18`'s own
  catalog note.

It's still a convention worth following; it's just not checked. If it
turns out to be mechanizable in practice, the rule to extend is
`section-order` in `lint-docs.js`.

**Field order here is not the same as the schema's property order.** The
[Schema page](https://designsystemdocspec.org/schema)'s property tables are
generated in each schema file's own declaration order — base entry fields
first, then the kind-specific ones appended — which is the right order for
a *reference table* you read top to bottom, and a different order from the
one above. This guide orders the fields of an *instance document* you
write; the schema page documents the shape of a *definition*. Neither is
wrong, and they are not going to converge: don't infer authoring order
from a property table, or vice versa.
