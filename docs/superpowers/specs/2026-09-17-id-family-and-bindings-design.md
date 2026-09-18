# Abstracting ids and bindings

**Status:** Proposed
**Date:** 2026-09-17
**Supersedes in part:** [PR #42](https://github.com/somerandomdude/design-system-documentation-schema/pull/42) (`fix(schema): allow real API identifier shapes in traitValue.id`)

## The three questions this answers

**1. Why did PR #42 not finish the job?** Because the pattern it loosened is copy-pasted into the places that consume it. You can name a trait `isDisabled`, then not write a combo about it.

**2. Can the same loosening serve tokens?** Yes, and it should, but loosening a pattern is the wrong long-term answer for foreign names. There is no pattern permissive enough for every platform's naming, so the schema needs a field whose job is to hold a verbatim foreign name rather than a pattern that keeps growing.

**3. Can traits abstract to slots and props?** Not by growing `traits`. That would push DSDS across the boundary it draws for itself. The part that generalizes is the *identifier*, not the trait, and a shared `binding` def carries it to slots, tokens, and anything else without a new entry-level concept.

---

## What's broken today

### The verified failure

PR #42 points `traitValue.id` at a new permissive `apiIdentifier` pattern. `combo.$defs.target` carries its own inline copy of the strict slug pattern, so a combo naming a camelCase trait fails validation:

```yaml
traits:
  - {kind: boolean, id: isDisabled, description: Blocks interaction.}
  - {kind: boolean, id: isLoading, description: Shows a spinner.}
combos:
  - {subject: isLoading, level: must-not, items: [isDisabled]}
```

```
✗ /combos/0/subject must match pattern "^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$"
✗ /combos/0/items/0 must match pattern "^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$"
```

Verified against PR #42's branch at `9e4b5b7` with `scripts/validate/validate.js`.

`DSDS-10` (`COMBO_TARGET_RESOLVES`) itself is fine. Its runtime resolution does set membership against the entry's real trait ids and never looks at a pattern. Only the schema-level pattern on `combo.$defs.target` blocks it, so fixing the pattern is sufficient.

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
| `common/id.schema.yaml#/$defs/apiIdentifier` (PR #42) | mixed case, single segment | yes |
| `common/combo.schema.yaml#/$defs/target` anyOf[1] | braced slug | no, inline |
| `common/ref.schema.yaml` `to` | slug or slash form, plus `#itemId` | no, inline |
| `entries/token.schema.yaml` `tokenType` | `^[a-z][a-zA-Z0-9]*$` | no, inline |

Any new id shape has to be added to all of them by hand. #42 added it to one.

---

## Phase 1: one id rule, stated once

### The rule

DSDS has exactly two kinds of id. The distinction is already real and already load-bearing; it is just implicit, re-derived at every site, and nowhere written down.

**Derived ids** come from prose via the lowercase-and-dash algorithm documented in `common/id.schema.yaml`'s own `$comment`. A guideline's `statement`, a definition's `term`, a step's or entry's `title`. They are slugs because a tool must be able to generate one deterministically from text, and because they become URL anchors. **Unchanged by this proposal.**

**Mirrored ids** are copied verbatim from something that already exists elsewhere: a React prop, a Web Component attribute, a DTCG token path, a Figma variable name. They are not derived from anything, and forcing them through the slug algorithm produces a name that is not the real name, which defeats the reason a tool reads them.

`tokenId` was already a partial, unnamed instance of the mirrored rule. `apiIdentifier` is a second one. Naming the rule lets the next case be answered by reference instead of by a new `$defs` entry.

### Two mirrored defs, not one

The obvious move is one permissive pattern for every mirrored id. Do not make it. Combo addressing uses `traitId.valueId`, so a dot inside a trait id makes `size.large` ambiguous between a trait named `size.large` and value `large` of trait `size`. The split preserves that:

```yaml
$defs:
  mirrored:
    type: string
    description: A single identifier copied verbatim from a real API, in whatever case that API uses.
    $comment: >-
      For an id that names something that already exists: a prop, an attribute, an enum
      value. Accepts camelCase, PascalCase, snake_case and kebab-case; rejects spaces,
      an empty string, and a leading or trailing dash. Deliberately allows a leading
      digit, since a real enum value can be a bare number (`<ds-heading>`'s `level`
      trait uses `1`-`6`). Deliberately forbids a dot, so a combo's `traitId.valueId`
      target stays unambiguous.
    pattern: '^[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*$'
    example: isDisabled

  mirroredPath:
    type: string
    description: One or more `mirrored` segments joined by a dot or a slash.
    $comment: >-
      For a token id, which usually comes from a design tool or a DTCG file that names
      paths. Same segment shape as `mirrored`, so a Figma variable named
      `Color/Action/Primary` validates alongside a DTCG path.
    pattern: '^[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*([./][A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*)*$'
    example: color.action.primary

  tokenId:
    $ref: '#/$defs/mirroredPath'
    $comment: The former name for `mirroredPath`. Kept because it shipped in 0.20.1.
```

`apiIdentifier` from PR #42 becomes `mirrored`. It has not shipped, so the rename is free. `tokenId` has shipped, so it stays as an alias.

Widening `tokenId` to accept mixed case is additive. Nothing previously valid becomes invalid.

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
      trait-then-value, which is why `mirrored` forbids a dot inside a segment.
    pattern: '^[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*(\.[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*)?$'
    example: size.large

  tokenRef:
    type: string
    description: A token reference, wrapped in braces.
    pattern: '^\{[A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*([./][A-Za-z0-9_$]+(-[A-Za-z0-9_$]+)*)*\}$'
    example: '{color.action.primary}'
```

**`ref.schema.yaml`'s `to`** gets the same widening on its entry half, so a mirrored-name token entry can be pointed at.

### The one cost, stated plainly

`ref.to`'s `$comment` currently claims:

> A capitalized display name (`to: Button`) or a value with a space in it can never be a real id, whatever else is in the document, so this catches that class of mistake with no other file needed.

Widening `to` to accept mixed case destroys half of that. `to: Button` becomes shape-valid.

Accept it, and update the `$comment` to stop claiming a guarantee it no longer provides. Two reasons. First, `DSDS-05` already does resolution-level checking, so the mistake is still caught, just one layer later and with another file in hand. Second, the alternative is a token entry named the way its design tool names it that nothing in the document can point at, which is a worse failure than a late-caught typo. The space check survives either way.

### Stop the drift

You cannot `$ref` a pattern into another pattern. JSON Schema has no regex composition, so `traitTarget` and `tokenRef` will always be hand-written copies of the `mirrored` segment shape. This is not fixable by refactoring, and it is exactly why #42's change reached one site out of three.

What is fixable is the silence. Add `scripts/checks/check-id-patterns.js`, asserting that every inline id pattern in the schema composes from one canonical segment regex, and wire it into `npm run check` beside `check-rule-catalog.js` and `check-schema-ids.js`. Copy-pasted and CI-guarded beats copy-pasted and silent.

Generating the patterns instead was considered and rejected. It would make source `.schema.yaml` files partly generated, which is a larger change in how the repo is authored, for protection a check already provides.

### Also in Phase 1

Cody's review note on #42 asked to slim the `apiIdentifier` `$comment`. That def is being rewritten here, so the trimming folds in rather than becoming a follow-up.

**Release:** patch. Nothing previously valid becomes invalid.

---

## Phase 2: `binding`

### Why a pattern is the wrong long-term answer

Phase 1 loosens the mirrored patterns as far as they should ever go. They still will not hold every real name. A CSS custom property leads with `--`. A Figma variable uses slashes and capitals and sometimes spaces. An iOS symbol is whatever Swift allows. Each one arriving as a new issue produces another `$defs` entry and another round of consumer-site fixes.

The fix is a field whose declared job is to hold a foreign name, with no pattern at all. Once that field exists, the pressure to keep loosening `id` stops, because `id` no longer has to be two things at once.

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
    description: The platform or framework this name belongs to.
    $comment: When the document declares a `metadata.platforms` list, this MUST be one of its entries.
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

### In use

```yaml
traits:
  - kind: boolean
    id: disabled
    description: Blocks interaction and removes the control from the tab order.
    bindings:
      - {platform: react, as: prop, name: isDisabled}
      - {platform: web-components, as: attribute, name: disabled}
      - {platform: ios, as: prop, name: isEnabled, note: Inverted.}
```

`as` is the typing. It is what lets one concept be a prop on one platform and a slot on another.

### What this buys beyond #42's problem

A single `id` cannot express that React's `isDisabled`, the web component's `disabled`, and iOS's inverted `isEnabled` are one design concept with three names. Today an author picks one and the other two are misdocumented. Loosening the `id` pattern does not help with this at all. It only lets the author pick a different single name.

It also answers the token question without touching `tokenId`. A Figma variable's name lives in a binding; the token's `id` stays a clean path.

And it promotes an escape hatch the schema already recommends. `common/id.schema.yaml`'s root `$comment` currently says:

> An id from an outside tool that doesn't fit this format goes under `$extensions.<namespace>.displayName` instead.

That is the right instinct in the wrong place. A real API name is not vendor data, it is a first-class fact about the thing being documented. Phase 2 updates that `$comment` to point at `bindings` for this case, leaving `$extensions` for genuine vendor payloads.

### Where it attaches

Three `$ref` sites on one shared def:

**`component.schema.yaml#/$defs/traitValue`**, covering a trait's own binding and each enum value's.

**`token.schema.yaml`**, so a token carries its per-platform names:

```yaml
kind: token
id: color.action.primary
bindings:
  - {platform: css, as: css-custom-property, name: --ks-color-action-primary}
  - {platform: figma, as: token, name: Color/Action/Primary}
```

**`section.schema.yaml`'s item shape**, which is how slots get covered. A slot is neither a variant nor a state, so it does not fit `kind: boolean|enum`, and the component entry has no `slots` field. Today a slot can only be a `definitions` item, whose id is a prose-derived slug:

```yaml
- kind: definitions
  items:
    - term: Leading icon
      definition: An icon rendered before the label, sized to the label's line height.
      bindings:
        - {platform: react, as: prop, name: leadingIcon}
        - {platform: web-components, as: slot, name: leading-icon}
```

That is "lots of ways to implement slots, as props, as dotted categories" expressed directly, with no new entry-level field.

### What was rejected, and why

**Growing `traits` into a typed API-surface list**, with `kind` extending past `boolean|enum` to `slot`, `event` and `method`, and the id pattern selected by `kind` via `if`/`then`.

Rejected on the project's own stated boundary. `AGENTS.md`:

> Don't reach for DSDS to *implement* a live API. It documents meaning and usage; it deliberately doesn't restate what a real interface contract already owns.

Traits earn their exception because variants and states are design vocabulary. A `size` and `variant` matrix is something a designer reasons about. A prop list is not, and a `className` passthrough is noise. Making `traits` the home for every API surface would turn it into the dumping ground that makes `specs` and `sourceFiles` redundant, and would put DSDS in the business of restating contracts it explicitly declines to own.

**A dedicated `slots` array on the component entry.** Same objection, smaller. It is also unnecessary once section items carry bindings.

**One collapsed mirrored def.** Rejected for the `traitId.valueId` ambiguity described in Phase 1.

### Conformance

One new advisory rule, matching the existing convention on `sourceFiles[].platform` and `imports[].platform`:

> **DSDS-17 (advisory), `BINDING_PLATFORM_DECLARED`.** When a document declares `metadata.platforms`, every `bindings[].platform` SHOULD be one of its entries.

Advisory rather than normative, because `metadata.platforms` is itself optional and a partial document is a legitimate intermediate state.

**Release:** minor, 0.21.0. `bindings` is optional at every site; a 0.20.x document is a valid 0.21.0 document.

---

## Architecture

Three layers, each with one job.

**`common/id.schema.yaml`** owns the id vocabulary: the derived slug, the two mirrored shapes, the namespaced extension point. It is the only file that decides what an id may look like.

**`common/binding.schema.yaml`** owns the mapping from a documented concept to a real name on a real platform. It holds no patterns, because its content is foreign by definition.

**Consumer sites** (`combo`, `ref`, `traitValue`, `token`, `section` items) `$ref` those two and add nothing of their own, except where JSON Schema forces an inline pattern. Those exceptions are enumerated and CI-guarded.

The dependency runs one direction. `binding` refs `id` for `platform` and `as`. `id` refs nothing. Nothing refs `binding` except the three consumer sites.

## Data flow

A tool reading a component asks two separable questions. *What does this concept mean?* is answered by `id`, `name`, `description`, `purpose`, and the surrounding documentation, all of it stable across platforms. *What do I type to use it here?* is answered by the matching `binding`, or by `id` itself when no binding is declared.

Today those two questions share one field, which is why a real prop name and a stable address are in conflict. Separating them is the whole design.

## Error handling

Three levels, unchanged in kind:

**Shape**, at the schema layer. A pattern rejects a malformed id. Phase 1's contribution is making the patterns agree so a shape error means a real mistake rather than an unpropagated loosening.

**Resolution**, in `validate.js`. `DSDS-10` checks that a combo target names a trait that exists. Pattern-agnostic already, so Phase 1 needs no change here.

**Advisory**, in the same pass. DSDS-17's platform check warns rather than fails, consistent with how the existing platform conventions are enforced.

## Testing

**Phase 1 regression fixtures.** The two failures verified above become permanent fixtures: a camelCase trait id referenced from a combo, and a slash-form token id referenced from a braced combo target. Both currently fail; both must pass. Add to the generated conformance suite via `scripts/generate/generate-conformance-suite.mjs`.

**Phase 1 negative fixtures.** A trait id containing a dot must still fail, protecting the `traitTarget` disambiguation. An id with a space, an empty id, and a leading or trailing dash must still fail.

**Phase 1 non-regression.** `test/site-components/components/heading.dsds.yaml`'s `1`-`6` enum values must keep validating, the case #42 already calls out. `npm run check:all` covers this.

**The drift check itself.** `check-id-patterns.js` needs its own test: mutate one inline pattern and confirm the check fails.

**Phase 2 fixtures.** A trait with bindings across three platforms including an inverted one. A token with a `--`-prefixed CSS binding and a slash-and-capitals Figma binding, neither of which any id pattern would accept, which is the point. A definitions item binding a slot to a prop on one platform and a named slot on another. One negative: a binding missing `name`.

**Phase 2 advisory.** A document declaring `metadata.platforms` with a binding naming a platform outside it warns and does not fail.

## Sequencing

Phase 1 ships alone as a patch and closes out #42. Phase 2 ships as 0.21.0 and depends on Phase 1 only for the renamed defs, not for any behavior.

Phase 1 first matters for a reason beyond ordering. Designing the id family while knowing bindings are coming is what keeps `mirrored` from being loosened further than it should be. The patterns get to stop at "real identifier shapes" rather than chasing "any name any platform might use," because Phase 2 owns that second case.
