# Abstracting ids and bindings

**Status:** Proposed
**Date:** 2026-09-17, revised 2026-09-18 against the `0.21.0` branch
**Responds to:** [PR #42](https://github.com/somerandomdude/design-system-documentation-schema/pull/42) and its review thread
**Targets:** the [`0.21.0` branch](https://github.com/somerandomdude/design-system-documentation-schema/tree/0.21.0), not `main`

> **Caveat before reading.** PJ said on 2026-09-18 that he wants to noodle on the Phase 2 idea and thinks it may work *without adding another property*. Phase 2 here adds one. This spec is an argument for that property, written so the tradeoff is visible, not a decision that has been made. Phase 1 is uncontested and PJ independently reached the same conclusion.

## The three questions this answers

**1. Why did PR #42 not finish the job?** Because the pattern it loosened is copy-pasted into the places that consume it. You can name a trait `isDisabled`, then not write a combo about it.

**2. Can the same loosening serve tokens?** Yes, and it should, but loosening a pattern is the wrong long-term answer for foreign names. There is no pattern permissive enough for every platform's naming, so the schema eventually needs a field whose job is to hold a verbatim foreign name rather than a pattern that keeps growing.

**3. Can traits abstract to slots and props?** Not by growing `traits`. That would push DSDS across the boundary it draws for itself, and it would re-conflate two axes the `0.21.0` branch just deliberately separated. The part that generalizes is the *identifier*, not the trait.

---

## What's broken today

### The verified failure

PR #42 points `traitValue.id` at a new permissive pattern. `combo.$defs.target` carries its own inline copy of the strict slug pattern, so a combo naming a camelCase trait fails validation:

```yaml
traits:
  - {traitType: state, kind: boolean, id: isDisabled, description: Blocks interaction.}
  - {traitType: state, kind: boolean, id: isLoading, description: Shows a spinner.}
combos:
  - {subject: isLoading, level: must-not, items: [isDisabled]}
```

```
✗ /combos/0/subject must match pattern "^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$"
✗ /combos/0/items/0 must match pattern "^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$"
```

Verified against PR #42's branch at `9e4b5b7`. `combo.schema.yaml` on the `0.21.0` branch is unchanged except for the `$id` version bump, so the bug is fully present there too.

`DSDS-09` (`COMBO_TARGET_RESOLVES`) itself is fine. Its runtime resolution does set membership against the entry's real trait ids via `collectTraitTargets` in `scripts/validate/validate.js` and never looks at a pattern. Only the schema-level pattern blocks it, so fixing the pattern is sufficient.

### The pre-existing sibling

Independent of #42, `tokenId` allows slash separators but combo's braced token pattern does not:

```
✗ /combos/0/subject "{color/action/primary}" must match pattern "^\{[a-z0-9]+...\}$"
```

A token whose id uses the slash form documented in `common/id.schema.yaml` can never be referenced in a combo.

### The root cause

Seven id patterns live in the schema. Four are `$ref`-able defs; three are inline literals that nothing keeps in sync:

| Where | Form | `$ref`-able |
|---|---|---|
| `common/id.schema.yaml` root | slug, dot-chained | yes |
| `common/id.schema.yaml#/$defs/tokenId` | slug, dot or slash | yes |
| `common/id.schema.yaml#/$defs/namespaced` | slug, requires a dot | yes |
| `common/id.schema.yaml#/$defs/apiId` (proposed) | mixed case, single segment | yes |
| `common/combo.schema.yaml#/$defs/target` anyOf[1] | braced slug | no, inline |
| `common/ref.schema.yaml` `to` | slug or slash form, plus `#itemId` | no, inline |
| `metadata/entry-metadata.schema.yaml#/$defs/statusValue` | single-segment slug | no, inline |

Any new id shape has to be added to all of them by hand. #42 added it to one.

Two other patterns look similar and are deliberately **not** in this family. `entries/token.schema.yaml`'s `tokenType` (`^[a-z][a-zA-Z0-9]*$`) constrains a DTCG type name, not an id. `metadata/metadata.schema.yaml`'s `^\d{4}-\d{2}-\d{2}$` is a date. Both stay as they are, and the drift check below must exclude them by an enumerated rule rather than by whoever writes it eyeballing the difference.

---

## Phase 1: one id rule, stated once

### The rule

DSDS has exactly two kinds of id. The distinction is already real and already load-bearing; it is just implicit, re-derived at every site, and nowhere written down.

**Derived ids** come from prose via the lowercase-and-dash algorithm documented in `common/id.schema.yaml`'s own `$comment`. A guideline's `statement`, a definition's `term`, a step's or entry's `title`. They are slugs because a tool must be able to generate one deterministically from text, and because they become URL anchors. **Unchanged by this proposal.**

**Mirrored ids** are copied verbatim from something that already exists elsewhere: a React prop, a Web Component attribute, a DTCG token path, a Figma variable name. Forcing them through the slug algorithm produces a name that is not the real name, which defeats the reason a tool reads them.

`tokenId` was already an unnamed instance of the mirrored rule. `apiId` is a second. Naming the rule lets the next case be answered by reference instead of by a new `$defs` entry.

Note that "derived" and "mirrored" are the names of the *rule*, not of the defs. The defs keep the `Id` suffix convention the schema already uses.

### Two defs, and the real reason they can't merge

PJ's review note gets to the right answer: *"I think we're going to need to keep this as a separate id due to the tokenIds needing to support slashes."* Correct conclusion, but the slash is not what forbids the merge. If slashes were the only obstacle you could merge the two and allow slashes everywhere.

**The dot is what forbids it.** `combo` addresses an enum value as `traitId.valueId`. Allow a dot inside a trait id and `size.large` is ambiguous between a trait named `size.large` and value `large` of trait `size`. That is why the single-segment form must stay dot-free, and therefore why it cannot be the same def as a path form.

On the name, of PJ's two options `apiId` is the better one. It matches the existing `tokenId` convention, and `traitValueId` bakes in exactly the scope this whole exercise is about outgrowing.

```yaml
$defs:
  apiId:
    type: string
    description: A single identifier copied verbatim from a real API, in whatever case that API uses.
    $comment: >-
      For an id that names something that already exists: a prop, an attribute, an enum
      value. Accepts camelCase, PascalCase, snake_case and kebab-case; rejects spaces,
      an empty string, and a leading or trailing dash. Deliberately allows a leading
      digit, since a real enum value can be a bare number (`<ds-heading>`'s `level`
      trait uses `1`-`6`). Deliberately forbids a dot, so a combo's `traitId.valueId`
      target stays unambiguous - that, not the slash, is why this can't be `tokenId`.
      `$` and `_` are legal identifier characters in the languages this mirrors, so a
      bare `_` validates; that is intended.
    pattern: '^[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*$'
    example: isDisabled

  tokenId:
    type: string
    description: The same as `apiId`, but segments can be chained with a dot or a slash.
    $comment: >-
      Only for token entries. Their id often comes from a design tool that names paths
      that way, and that tool's casing comes with it - a Figma variable named
      `Color/Action/Primary` is the real name, so it validates as written.
    pattern: '^[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*([./][A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*)*$'
    example: color/action/primary
```

`tokenId` keeps its name, so nothing that already `$ref`s it changes. Widening it to accept mixed case is additive, and this was checked rather than assumed: the acceptance sets of the old `tokenId`, the old braced-token pattern, and the old base `id` are each strict subsets of their replacements. Nothing previously valid becomes invalid.

### Fix the consumers

**`combo.$defs.target`** grows from two branches to three, replacing the inline slug copy:

```yaml
target:
  description: An entry id, a trait target on this entry, or a braced token reference.
  anyOf:
    - $ref: https://designsystemdocspec.org/v0.21.0/common/id.schema.yaml
    - $ref: '#/$defs/traitTarget'
    - $ref: '#/$defs/tokenRef'

$defs:
  traitTarget:
    type: string
    description: A boolean trait's id, or `traitId.valueId` for one enum value.
    $comment: >-
      Exactly one optional dot. The addressing form is never deeper than
      trait-then-value, which is why `apiId` forbids a dot inside a segment.
    pattern: '^[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*(\.[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*)?$'
    example: size.large

  tokenRef:
    type: string
    description: A token reference, wrapped in braces.
    pattern: '^\{[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*([./][A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*)*\}$'
    example: '{color.action.primary}'
```

**`ref.schema.yaml`'s `to`** gets the same widening on its entry half, so a mirrored-name token entry can be pointed at.

`scripts/checks/check-schema-ids.js` hard-asserts that every `$id` and internal `$ref` matches `https://designsystemdocspec.org/v<package version>/<path>`, and `npm run bump-version` rewrites all of them. On the `0.21.0` branch that version is already `0.21.0`; never hand-edit one reference out of step with the rest.

### The one cost, stated plainly

`ref.to`'s `$comment` currently claims:

> A capitalized display name (`to: Button`) or a value with a space in it can never be a real id, whatever else is in the document, so this catches that class of mistake with no other file needed.

Widening `to` to accept mixed case destroys half of that. `to: Button` becomes shape-valid.

Accept it, and update the `$comment` to stop claiming a guarantee it no longer provides. Three reasons. First, `DSDS-08` (`ENTRY_REF_RESOLVES`) already checks that a bare `to:` resolves to a real entry, so the mistake is still caught, one layer later. Be honest in the rewritten `$comment` that this is a downgrade and not a lateral move: in single-file validation DSDS-08 emits a **warning**, not an error, because it cannot see the other files that might hold the target. Second, `entries/entry.schema.yaml`'s own `id` is a bare `type: string` with no pattern at all, so `kind: component, id: Button` already validates today; the shape-level guarantee was never as complete as the `$comment` implied. Third, the alternative is a token entry named the way its design tool names it that nothing in the document can point at, which is a worse failure than a late-caught typo. The space check survives either way.

### Stop the drift

You cannot `$ref` a pattern into another pattern. JSON Schema has no regex composition, so `traitTarget` and `tokenRef` will always be hand-written copies of the `apiId` segment shape. This is not fixable by refactoring, and it is exactly why #42's change reached one site out of three.

What is fixable is the silence. Add `scripts/checks/check-id-patterns.js`, asserting that every id pattern in the schema composes from one canonical segment regex, and wire it into `npm run check` beside `check-rule-catalog.js` and `check-schema-ids.js`.

The check needs an explicit inventory, not a heuristic, or whoever writes it will guess. **In scope**, and each must compose from the canonical segments:

- `common/id.schema.yaml` root, `apiId`, `tokenId`, `namespaced`
- `common/combo.schema.yaml#/$defs/traitTarget` and `#/$defs/tokenRef`
- `common/ref.schema.yaml`'s `to`
- `metadata/entry-metadata.schema.yaml#/$defs/statusValue`

**Out of scope**, and the check must skip them by name rather than by shape:

- `entries/token.schema.yaml`'s `tokenType` — a DTCG type name, not an id
- `metadata/metadata.schema.yaml`'s date pattern — not an id

The in/out list lives in the check file itself, so adding a pattern to the schema without classifying it fails CI. That is the actual protection: copy-pasted and CI-guarded beats copy-pasted and silent.

### Also in Phase 1

PJ's review note asked to slim the long `$comment` #42 added. That def is being rewritten here, so the trimming folds in rather than becoming a follow-up.

**Release: rides the `0.21.0` branch.** Everything in Phase 1 is a loosening, which `site/content/stability.mdx` puts at patch, so it does not force a version of its own. `0.21.0` is already an unreleased minor carrying a breaking trait change, so this lands inside it. A CHANGELOG entry under the existing `[0.21.0]` heading is required; the stability page treats the CHANGELOG as the upgrade contract.

---

## Phase 2: `binding`

### The argument got stronger on the 0.21.0 branch

`0.21.0` removes `setBy` (`consumer|component`) and replaces it with a required `traitType` (`variant|state`). Its own CHANGELOG names what that costs:

> Note the loss: nothing in the format now distinguishes a state the caller switches on (`disabled`) from one the component enters by itself (`hover`), **which is the signal code generation used to decide what becomes a prop.** Put it under `$extensions` if you need it.

That is the gap this phase fills, and it fills it better than `setBy` did. `setBy` was a binary you had to infer a prop from. A binding says which platform, which surface, and under what exact name. It restores a signal the branch just deleted rather than adding a speculative one, and it does so as a first-class field instead of the `$extensions` workaround the CHANGELOG currently has to recommend.

### Why a pattern is the wrong long-term answer

Phase 1 loosens the mirrored patterns as far as they should ever go. They still will not hold every real name. A CSS custom property leads with `--`. A Figma variable uses slashes and capitals and sometimes spaces. An iOS symbol is whatever Swift allows. Each one arriving as a new issue produces another `$defs` entry and another round of consumer-site fixes.

The fix is a field whose declared job is to hold a foreign name, with no pattern at all. Once that field exists, the pressure to keep loosening `id` stops, because `id` no longer has to be two things at once.

### Why not fold this into `traitType`

The obvious "without adding another property" move is to extend `traitType` past `variant|state` to cover `prop`, `slot`, `attribute` and so on. The `0.21.0` branch argues against that itself, in the `traits` `$comment` it just added:

> Two independent axes, deliberately. `kind` is the `anyOf` discriminator... `traitType` is the taxonomy a reader wants, and both kinds can be either type: `hover` is a boolean state, `size` an enum variant.

Platform naming is a third axis, orthogonal to both. A `size` trait is a `variant` (taxonomy) of `kind: enum` (form) exposed as a `prop` on React and an `attribute` on a web component (surface). Those three facts vary independently, and a single trait can hold different answers to the third on different platforms, which neither of the first two can express. Folding surface into `traitType` re-conflates what the branch just separated on purpose, and it cannot represent the per-platform case at all.

### The shape

New file, `schema/common/binding.schema.yaml`:

```yaml
$schema: https://json-schema.org/draft/2020-12/schema
$id: https://designsystemdocspec.org/v0.21.0/common/binding.schema.yaml
title: Binding
type: object
description: How one documented concept is actually named in one platform's real API.
$comment: >-
  A pointer, not a restated contract. It says "the thing this document describes is
  called X over there", the same job `sourceFiles`, `specs` and a token's `source`
  already do at the file level. It does not describe types, defaults or signatures,
  which a real contract document owns.
required: [platform, name]
properties:
  platform:
    $ref: https://designsystemdocspec.org/v0.21.0/common/id.schema.yaml
    description: The platform or framework this name belongs to. When the document declares a `metadata.platforms` list, this MUST be one of its entries.
    example: react
  as:
    description: What kind of API surface this is on that platform.
    oneOf:
      - type: string
        enum: [prop, attribute, slot, css-custom-property, event, method, class, token]
      - $ref: https://designsystemdocspec.org/v0.21.0/common/id.schema.yaml#/$defs/namespaced
    example: prop
  name:
    type: string
    minLength: 1
    description: The identifier exactly as that platform spells it.
    $comment: >-
      Deliberately unconstrained. This field exists to hold a foreign name verbatim,
      so a pattern here would only reintroduce the problem it was added to solve:
      a CSS custom property leads with `--`, a Figma variable uses slashes and capitals.
    example: isDisabled
  note:
    type: string
    description: Anything the name alone doesn't convey.
    example: Inverted relative to the documented concept.
  since:
    $ref: https://designsystemdocspec.org/v0.21.0/common/since.schema.yaml
    description: The version this binding was introduced.
additionalProperties: false

$defs:
  list:
    type: array
    minItems: 1
    description: One binding per platform.
    items:
      $ref: https://designsystemdocspec.org/v0.21.0/common/binding.schema.yaml
```

A new file under `schema/common/` is picked up automatically by `buildDefIndex` in `scripts/site/render-prop-table.js`, so `check-docs-coverage.mjs` is satisfied with no site-code edit.

Note the `platform` description is written inline rather than split into a `$comment`, matching the consolidation `0.21.0` just applied to `sourceFiles[].platform` and `imports[].platform`.

### In use

```yaml
traits:
  - traitType: state
    kind: boolean
    id: disabled
    description: Blocks interaction and removes the control from the tab order.
    bindings:
      - {platform: react, as: prop, name: isDisabled}
      - {platform: web-components, as: attribute, name: disabled}
      - {platform: ios, as: prop, name: isEnabled, note: Inverted.}
```

One concept, one taxonomy, one form, three surfaces. A single `id` cannot express that React's `isDisabled`, the web component's `disabled`, and iOS's inverted `isEnabled` are the same thing. Today an author picks one and the other two are misdocumented, and loosening the `id` pattern does not help with that at all. It only lets the author pick a different single name.

It also answers the token question without touching `tokenId`. A Figma variable's name lives in a binding; the token's `id` stays a clean path.

And it promotes an escape hatch the schema already recommends twice. `common/id.schema.yaml`'s root `$comment` says an id that doesn't fit "goes under `$extensions.<namespace>.displayName` instead," and `0.21.0`'s CHANGELOG says to put the lost `setBy` signal "under `$extensions` if you need it." Both are the right instinct in the wrong place. A real API name is not vendor data, it is a first-class fact about the thing being documented.

### Where it attaches

**`component.schema.yaml#/$defs/traitValue`.** One attach point covers a trait's own binding and each enum value's. All three trait wrappers close with `unevaluatedProperties: false`, which a property declared on `traitValue` satisfies, so no wrapper needs editing.

**`token.schema.yaml`**, so a token carries its per-platform names:

```yaml
kind: token
id: color.action.primary
bindings:
  - {platform: css, as: css-custom-property, name: --ks-color-action-primary}
  - {platform: figma, as: token, name: Color/Action/Primary}
```

**`definitions.schema.yaml`'s item shape, plus `section.schema.yaml`'s base item shape**, which together are how slots get covered. A slot is neither a variant nor a state, so it does not fit `traitType` or `kind`, and the component entry has no `slots` field. A slot is a named thing with a meaning, which is exactly what a `definitions` item is:

```yaml
- kind: definitions
  items:
    - term: Leading icon
      definition: An icon rendered before the label, sized to the label's line height.
      bindings:
        - {platform: react, as: prop, name: leadingIcon}
        - {platform: web-components, as: slot, name: leading-icon}
```

**There is a trap here that costs a day if you hit it.** `section.schema.yaml`'s base declares `items: {type: object}` with no `properties` block at all. The three section kinds each declare their own `items.items` and close with `additionalProperties: false`, and each file additionally closes with `unevaluatedProperties: false`. Adding `bindings` only to the base's item shape is therefore silently ineffective for those three. Verified empirically: the worked example above fails today with `/items/0 must NOT have additional properties`.

**And a matching hole in the other direction.** The generic `kind: section` inherits the base's `items: {type: object}` with no `additionalProperties` constraint at all, so a generic-section item carrying arbitrary keys validates today, unchecked. Declaring `bindings` only on `definitions` would leave three behaviors: validated on `definitions`, hard-rejected on `guidelines`/`steps`/`freeformEntry`, and silently accepted-but-unvalidated on generic sections. The third is the worst, and it lands exactly where it hurts: `section.schema.yaml`'s own `context` `$comment` offers **`acme.slots`** as its example of a custom section context, so the one place the schema itself gestures at slots is the one place that would neither validate nor reject a binding.

So declare `bindings` in two places: on `section.schema.yaml`'s base item shape, which closes the generic-section hole without constraining anything else the base leaves open, and on `definitions.schema.yaml`'s own item properties, which is the only way through that file's `additionalProperties: false`.

**Deliberately excluded.** `guidelines` items are prose rules and `steps` items are actions; neither names a thing with an API surface. `section.schema.yaml#/$defs/freeformEntry` is prose structure, not a named concept, and its `title` is a heading rather than a term. Each is its own `additionalProperties: false` shape that would need its own edit, and none earns one. If a real document later needs a binding on a step, add it then.

**Declaration order matters more than it used to.** `0.21.0` extends `DSDS-22` (`nested-field-order`) to cover traits, reading the canonical order off `component.schema.yaml` at runtime. So `bindings`' declared position becomes the author-facing order in two places, not one: last in `traitValue` after `since`, and after `aliases` before `$extensions` in the definitions item shape, matching how the other item shapes end.

**One honesty note for whoever writes the fixtures.** No existing document in this repo documents a slot as a `definitions` item. The whole corpus has two `definitions` sections, both `context: terms`. Where slots appear today they are prose inside `guidelines` statements (`test/site-components/components/guide-section.dsds.yaml`, `header.dsds.yaml`) or entry `description` text, and Phase 2 excludes `guidelines` items. This is a proposal for how slots *should* be documented, not a description of a path an existing document already takes. The Phase 2 slot fixture is net-new authoring, not a conversion.

### What was rejected, and why

**Growing `traits` into a typed API-surface list**, with `traitType` extending to `slot`, `event` and `method`.

Rejected twice over. First on the axis argument above: `0.21.0` separated taxonomy from form on purpose, and surface is a third axis that varies per platform, which neither of the other two can carry. Second on the project's own stated boundary, from `AGENTS.md`:

> Don't reach for DSDS to *implement* a live API. It documents meaning and usage; it deliberately doesn't restate what a real interface contract already owns.

Traits earn their exception because variants and states are design vocabulary. A `size` and `variant` matrix is something a designer reasons about. A prop list is not, and a `className` passthrough is noise. Making `traits` the home for every API surface would turn it into the dumping ground that makes `specs` and `sourceFiles` redundant.

**A dedicated `slots` array on the component entry.** Same boundary objection, smaller. Also unnecessary once definitions items carry bindings.

**One collapsed mirrored def.** Rejected for the `traitId.valueId` ambiguity in Phase 1.

### Conformance: extend DSDS-02, add no new rule

`DSDS-02` (`PLATFORM_VOCABULARY`, `enforcement: semantic`) already owns this constraint, and its catalog text already overclaims relative to its implementation:

> When a `kind: system` entry declares `metadata.platforms`, every `platform` value used **anywhere in the document** must be one of them. This includes a component's own `sourceFiles` and `imports` entries, and a status entry.

So add `bindings[].platform` to DSDS-02's site list and its catalog text. Do **not** add a new advisory rule. A new rule would put two rules of opposite strictness on one constraint, leave DSDS-02's "anywhere in the document" false by omission, and break `npm run check`, because `check-rule-catalog.js` scans `README.md` for range prose and `README.md:84` names the range as `DSDS-01`–`DSDS-23`.

Extending a semantic rule is a tightening, which `stability.mdx` puts in the minor row. That costs nothing here: `0.21.0` is already an unreleased minor carrying a breaking trait change. And the practical blast radius is zero, since a rule that fires only on a field which did not exist cannot fail any previously-passing document.

**Release: also rides the `0.21.0` branch, if PJ agrees in time.** If the binding question needs longer, Phase 1 ships in `0.21.0` alone and Phase 2 moves to `0.22.0`. The version follows the decision, not the other way round.

---

## Architecture

Three layers, each with one job.

**`common/id.schema.yaml`** owns the id vocabulary: the derived slug, `apiId`, `tokenId`, and the namespaced extension point. It is the intended single source for what an id may look like. It is not literally the only one today — `entries/entry.schema.yaml`'s `id` is a bare `type: string`, and `entry-metadata.schema.yaml`'s `statusValue` carries its own inline slug — which is why Phase 1's drift check has to enumerate the exceptions rather than assume there are none.

**`common/binding.schema.yaml`** owns the mapping from a documented concept to a real name on a real platform. It holds no patterns of its own, because its content is foreign by definition.

**Consumer sites** (`combo`, `ref`, `traitValue`, `token`, `definitions` items, the base section item) `$ref` those two and add nothing of their own, except where JSON Schema forces an inline pattern. Those exceptions are enumerated in the drift check.

The dependency runs one direction. `binding` refs `id` for `platform` and `as`. `id` refs nothing.

## Data flow

A tool reading a component asks two separable questions. *What does this concept mean?* is answered by `id`, `name`, `description`, `purpose`, `traitType`, and the surrounding documentation, all of it stable across platforms. *What do I type to use it here?* is answered by the matching `binding`, or by `id` itself when no binding is declared.

Today those two questions share one field, which is why a real prop name and a stable address are in conflict. Separating them is the whole design.

## Error handling

Three levels, unchanged in kind:

**Shape**, at the schema layer. Phase 1's contribution is making the patterns agree so a shape error means a real mistake rather than an unpropagated loosening.

**Resolution**, in `validate.js`. `DSDS-09` checks that a combo target names a trait that exists; `DSDS-08` checks that a bare `to:` resolves; `DSDS-02` closes the platform vocabulary. All three are pattern-agnostic, so Phase 1 needs no change to any of them, and Phase 2 extends only DSDS-02's site list. In single-file validation the resolution rules degrade to warnings, since they cannot see files they were not given.

## Testing

**Phase 1 regression fixtures.** The two failures verified above become permanent fixtures: a camelCase trait id referenced from a combo, and a slash-form token id referenced from a braced combo target. Both currently fail; both must pass. Add to the generated conformance suite via `scripts/generate/generate-conformance-suite.mjs`.

**Phase 1 negative fixtures.** A trait id containing a dot must still fail, protecting the `traitTarget` disambiguation. An id with a space, an empty id, and a leading or trailing dash must still fail.

**Phase 1 non-regression.** `test/site-components/components/heading.dsds.yaml`'s `1`-`6` enum values must keep validating, the case #42 already calls out. `npm run check:all` covers this.

**The drift check itself.** `check-id-patterns.js` needs its own test: mutate one inline pattern and confirm the check fails. Add a second that introduces an unclassified pattern and confirms the check fails on that too, since the in/out inventory is the check's real value.

**Phase 2 fixtures.** A trait with bindings across three platforms including an inverted one. A token with a `--`-prefixed CSS binding and a slash-and-capitals Figma binding, neither of which any id pattern would accept, which is the point. A definitions item binding a slot to a prop on one platform and a named slot on another. A generic `kind: section` item with a binding, which must now validate rather than pass unchecked — without this fixture the hole reopens silently. Three negatives: a binding missing `name`, a binding on a `guidelines` item, and a binding naming a platform outside a declared `metadata.platforms`, which must now be a hard DSDS-02 error rather than a warning.

## Sequencing

Both phases target the `0.21.0` branch rather than `main`, since `0.21.0` rewrites the same trait block and is nine commits ahead. PR #42 retargets there.

Phase 1 is uncontested and lands first. Phase 2 is a proposal pending PJ's own thinking, and ships in `0.21.0` only if that resolves before the branch does; otherwise `0.22.0`.

Phase 1 first matters for a reason beyond ordering. Designing the id family while knowing bindings may be coming is what keeps `apiId` from being loosened further than it should be. The patterns get to stop at "real identifier shapes" rather than chasing "any name any platform might use," because Phase 2 owns that second case.
