# DSDS authoring style guide

How to order things inside a DSDS document, so every document reads the same way no matter who wrote it.

None of this changes whether a document is valid. The schema accepts any order. Four warning-only rules — `DSDS-17` through `DSDS-20`, in the [advisory tier](https://designsystemdocspec.org/conformance#enforcement-tiers) — point out anything out of order when you run `npm run lint`. Nothing here can fail `npm run check:all`. See [Tooling](#tooling) for what gets checked automatically and what's left to you.

These guidelines are nothing more than opinions. Ignore them if a different organization reads better for your needs.

## The patterns behind these rules

Everything below is one of a few ideas, applied to a different part of a document. Learn these and you can usually work out the specific rule.

**Field order comes from the schema. List order comes from this guide.** What order an object's fields go in is written down in the schema files, so read it there — that's [§1](#1-entry-level-field-order) and [§4](#4-field-order-inside-smaller-shapes). Which entry, section, or item comes first in a list is something a schema can't express, so this guide decides it — that's [§2](#2-section-order-within-sections) and [§3](#3-guideline-item-order-within-one-section).

**Broadest first.** The widest thing leads: `guidelines` before `steps`, `when-to-use` before `how-to-use`, `for: all` before `for: agent`, a section about the whole entry before one about a single tag.

**Nothing comes before the thing it's built on.** Tokens before the themes that override them, themes before the components that use them. Read top to bottom and you meet every idea before anything that depends on it.

**Shared fields before specific ones.** The fields every kind has come first, then the fields one kind adds. A `metadata` block works the same way.

**Catch-alls go last.** `$extensions` after every real field, the plain `section` kind after the three specific ones, custom kinds after the five known ones. Anything that exists because nothing else fit goes at the end.

**Sorts stack, and each one only breaks ties in the one above it.** Sort by kind, then by how broad, then by who it's for. A later sort never moves something ahead of what an earlier one already settled.

**Where no rule decides, keep the order you wrote.** Don't alphabetize. Items sharing a `level`, entries sharing a kind — leave them in whatever order reads best.

One rule sits outside all of this: a `ref` puts `to` or `href` first, ahead of `rel`, which is not the order its schema file lists. [§4](#4-field-order-inside-smaller-shapes) explains why. It's the only place this guide overrides the schema.

---

## 1. Entry-level field order

### The schema is the style guide

**Write an entry's fields in the order the schema lists them.** The order of properties and options in the schema reflect the guidelines' recommendations on how to organize your schema documents. When in doubt, copy how the schema does it.

Follow the high-level order:

1. **Shared entry fields _except_ `$extensions`** defined in [`entries/entry.schema.yaml`](schema/entries/entry.schema.yaml) .
2. **Then that kind's own fields**, defined in `entries/<kind>.schema.yaml`. A custom kind has no file of its own, so should follow the high-level guidance.
3. **Then `$extensions`.** All information that adds to the schema goes last.

If a document is ordered differently, the `DSDS-17` warning prints the whole order it expected.

### Base documents and shared entries

Same idea, different file. A base document (one with `schemaVersion`) follows [`base.schema.yaml`](schema/base.schema.yaml). A `shared` entry follows [`shared.schema.yaml`](schema/shared.schema.yaml).

Each of those is one list, so there's nothing to join. And a `shared` entry genuinely has fewer fields than an entry, rather than the same list with gaps in it — it has no `kind`, `purpose`, `extends` or `related`. That file explains why.

`DSDS-20` checks base documents. `DSDS-17` checks shared entries, falling back to `shared.schema.yaml` when an object has no `kind`.

### Entry order, inside `entries[]`

The rule above orders the fields of one entry. When a base document holds several entries, order the entries themselves by `kind`, in the order [`entries/entry.schema.yaml`](schema/entries/entry.schema.yaml) lists its `kind` values — which starts with the ones everything else is built on:

1. **`system`** — always first. It isn't one of the group; it's what the document is about, and the other entries belong to it. One per document at most.
2. **`token`** — the values everything else is built from.
3. **`theme`** — a named set of token overrides, so it only makes sense after the tokens it overrides.
4. **`component`** — built from tokens and themes.
5. **`entry`**, then any custom kind — foundations, patterns and guides, which are usually built from the components above. Custom kinds go last, since a reader can't tell their shape from the spec.

It's the same idea §2 uses for sections: broadest first, and nothing before the thing it depends on. Read top to bottom and you meet each idea before the entries that use it, instead of scrolling back to find out what some token three entries ago actually was.

Within one kind, use whatever order reads best — usually the order someone would learn them in, not alphabetical. A scale reads better as `space-1`, `space-2`, `space-4` than as `space-1`, `space-2`, `space-24`.

```yaml
entries:
  - id: acme-design-system   # kind: system   — what the document is about
  - id: color.action.primary # kind: token
  - id: light                # kind: theme    — overrides the tokens above
  - id: dark                 # kind: theme
  - id: button               # kind: component
  - id: form-layout          # kind: entry    — a pattern built from components
```

---

## 2. Section order, within `sections[]`

### Keep each kind together

If an entry has more than one section, **put all the sections of the same kind side by side** — every `guidelines` section in a row, then every `definitions` section, then every `steps` section, then any plain `section`. Don't mix them up: `guidelines`, `definitions`, `guidelines` is wrong, even if that's the order you thought of them in.

### Kind order: broadest first

When an entry uses more than one kind, order the kinds like this:

1. **`guidelines`** — the broadest question. Should I use this at all, and how do I use it properly?
2. **`definitions`** — reference material: parts, terms, a glossary. Narrower than guidelines, because it's about this entry's own parts and words. Wider than a set of steps.
3. **`steps`** — one procedure or checklist. The narrowest of the three, because it's one exact sequence rather than general advice.
4. **`section`** (the plain kind) — prose that didn't fit the other three. Last, because it's the fallback.

That's the order [`sections/section.schema.yaml`](schema/sections/section.schema.yaml) lists its `kind` values in. A namespaced custom kind goes last, after all four, since it isn't in that list.

### Within `guidelines`: how broad, then who it's for

An entry often has more than one `guidelines` section. Sort them twice: first by **how broad** they are, then by **who they're for**.

How broad, widest first — the order [`sections/guidelines.schema.yaml`](schema/sections/guidelines.schema.yaml) lists its `framing` values in:

1. **`framing: when-to-use`** — should you reach for this at all. The widest question there is.
2. **`framing: how-to-use`** (or no `framing`, which means the same thing) covering the whole entry — rules that apply everywhere.
3. **Sections about one tag** — a section where every item carries the same tag, like the accessibility rules or the mobile-only ones. Narrowest, so it goes last. If there are several, order them alphabetically by tag unless there's a good reason not to. Accessibility rules usually lead, since they're rarely optional in practice.

Who it's for, widest audience first — the order [`sections/section.schema.yaml`](schema/sections/section.schema.yaml) lists its `for` values in:

1. **`for: all`**
2. **`for: human`**
3. **`for: agent`**

`for: all` leads because it's the only one every reader sees. `for: agent` goes last because it's the narrowest — notes a person never reads, which normally add to the human-facing sections above rather than replace them.

Both of those orders are written down in the schema, as the order each field lists its allowed values in. The checks read them from there, so this page is describing those files rather than keeping its own copy.

The two sorts apply in that order: **how broad first, who it's for second.** A `for: agent` when-to-use section still comes before a `for: all` how-to-use one, because breadth is settled first. Audience only decides the order of sections that are already tied — same `framing`, and neither one about a single tag.

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
                                    # about one tag, so it follows every
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

Order items by `level`, in the order [`common/requirement-level.schema.yaml`](schema/common/requirement-level.schema.yaml) lists its values in:

```
must
should
may
should-not
must-not
```

That isn't the order [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) presents them in, which pairs each word with its opposite. This reads as a scale instead, from "always do this" to "never do this", with the two softer levels in the middle. Read top to bottom and you get the firm rules first, the judgment calls next, and the hard don'ts last. That's an editorial choice, which is why the reason for it is written here — but the order itself lives in the schema, and the check reads it from there.

Within one level, keep items in whatever order tells the best story — usually the order you wrote them in. There's no second sort. Don't alphabetize items that share a level; it normally makes the section read worse.

```yaml
items:
  - level: must
    statement: Use semantic tokens instead of raw values.
  - level: should
    statement: Prefer the `primary` variant for the page's one main action.
  - level: may
    statement: Add a leading icon when it disambiguates the action.
  - level: should-not
    statement: Should not pair `loading` with `disabled` in the same interaction.
  - level: must-not
    statement: Never stack two primary-variant buttons in the same view.
```

---

## 4. Field order inside smaller shapes

[§1](#1-entry-level-field-order)'s rule goes all the way down. Order the fields of a section, an item, a `metadata` block, a `combo` or a `ref` the way its own schema file lists them.

Most of these shapes are a single list, so there's nothing to join and nothing for this guide to repeat.

| Shape | Its schema file |
|---|---|
| A `guidelines` item | [`sections/guidelines.schema.yaml`](schema/sections/guidelines.schema.yaml) |
| A `definitions` item | [`sections/definitions.schema.yaml`](schema/sections/definitions.schema.yaml) |
| A `steps` item | [`sections/steps.schema.yaml`](schema/sections/steps.schema.yaml) |
| A `combo` | [`common/combo.schema.yaml`](schema/common/combo.schema.yaml) |

Two shapes are built from two files, the way an entry is, so they need a rule for joining the lists.

**A `metadata` block** follows §1's rule exactly: the fields every entry's metadata shares, from [`metadata/metadata.schema.yaml`](schema/metadata/metadata.schema.yaml), then the ones for that kind of entry, from [`metadata/entry-metadata.schema.yaml`](schema/metadata/entry-metadata.schema.yaml) or [`metadata/system-metadata.schema.yaml`](schema/metadata/system-metadata.schema.yaml), then `$extensions` last.

**A section** is the one place that rule doesn't hold. A section kind adds a single field — `framing` for `guidelines`, `ordered` for `steps` — and it goes immediately after `for`, not after the rest of the shared fields. So a `guidelines` section reads `kind`, `for`, `framing`, then `title` and whatever else it has. The field says what sort of section this is, so it belongs up with `kind` and `for` where a reader is already looking, rather than buried further down.

**One deliberate exception: a `ref`.** Write `to` or `href` first, then `rel`, then `role` and `note`. That's not the order [`common/ref.schema.yaml`](schema/common/ref.schema.yaml) lists them in — it puts `rel` first. "What does this point at" reads better than "what kind of pointer is it", and every example in this repo already does it this way. It's the one place this guide overrides the schema, which is why it's written down here instead of left as a habit. Nothing checks the smaller shapes, so nothing enforces the rule or the exception.

---

## 5. A complete example

```yaml
id: badge
kind: component
name: Badge
description: A small status indicator, attached to another element.
purpose: Draws attention to a count, state, or category without interrupting the layout it's attached to.
metadata:
  tags: [status, indicator, count]
  since: 1.2.0
  status: {status: stable}
sections:
  - kind: guidelines
    for: all
    framing: when-to-use
    items:
      - level: should
        statement: Use to surface a count or state on another element (a notification count, an unread indicator).
      - level: should-not
        statement: Do not use as a replacement for a full status message a user needs to act on.

  - kind: guidelines
    for: all
    items:
      - level: must
        statement: Keep label text to a single word or number.
      - level: must
        statement: Pair with an accessible label when the badge conveys meaning color alone cannot.
      - level: should
        statement: Prefer the `dot` variant when the exact count isn't meaningful to the user.

  - kind: guidelines
    for: all
    title: Accessibility
    items:
      - level: must
        statement: Expose the badge's content to assistive technology even when visually decorative.

  - kind: definitions
    for: all
    context: anatomy
    items:
      - term: Dot
        definition: The minimal variant with no visible label, just a colored indicator.

related:
  - to: avatar
    rel: pairs-with
refs:
  - href: https://github.com/org/ds/react/badge
    rel: source
sourceFiles:
  - platform: react
    file: ./src/Badge.tsx
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
```

---

## Tooling

Four warning-only rules check this guide. They live in `scripts/validate/lint-docs.js`, are listed in `schema/conformance-rules.yaml` as `enforcement: advisory`, and run with `npm run lint`:

| Rule | Checks | This guide |
|---|---|---|
| `DSDS-17` | An entry's own field order | [§1](#1-entry-level-field-order) |
| `DSDS-18` | `sections[]` grouping and order | [§2](#2-section-order-within-sections) |
| `DSDS-19` | Guideline item order by `level` | [§3](#3-guideline-item-order-within-one-section) |
| `DSDS-20` | A base document's own field order | [§1](#base-documents-and-shared-entries) |

Getting the order wrong should never fail `npm run check:all`, and it can't: these rules only warn, and always exit 0. `lint-docs.js` does fail if a rule is listed without a check, or a check exists without a rule.

**One thing isn't checked.** `DSDS-18` skips the "sections about one tag" part of §2. Working out that a section "is really just the accessibility rules" means reading its items, not looking at its shape — unlike `framing` and `for`, which are plain fields. It's still worth following; it just isn't checked. If it turns out to be checkable after all, the rule to extend is `section-order` in `lint-docs.js`.

**Field order has one source: the schema files.** The tables on the [Schema page](https://designsystemdocspec.org/schema) are generated from each schema file's own order, `DSDS-17` and `DSDS-20` read that same order when they run, and [§1](#1-entry-level-field-order) tells you to follow it. So you can read the authoring order off a property table, and the other way round.

This guide used to carry its own copy of that order, written out by hand. It fell out of date twice — once with `related` and `extends` the wrong way round, once with `imports` in the wrong place — and nobody noticed until something compared the two copies. Deleting the copy is what makes the rule checkable rather than just stated. Ordering items in a list ([§2](#2-section-order-within-sections) onward) is different: the schema has no opinion about which entry or section comes first, so those rules do belong here.
