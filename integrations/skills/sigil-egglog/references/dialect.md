# Claims dialect

This note is language background for a claims interpreter. It does not replace the guidance beside the brief.

## Which side is binding

- The guidance beside the brief is binding for row shapes and accepted names.
- This skill is binding for egglog/datalog language (what a fact, relation, rule, or schedule is).
- `sigil-understand` is optional background on the design language.

Do not restate column tables here. Copy row shapes from the guidance's `vocabulary.md`.

## Data only

Return a plain list of S-expression rows and nothing else; every argument is a quoted string literal.

These kinds exist: `claim`, `property`, `measure`, `reading`, `step`, `guard`. Nested expressions, arithmetic, and numbers that are not quoted strings are refused. A row names its Facet by the brief's handle, and a handle the brief did not issue is refused.

## Whole-artifact refuse

A `rule`, `command`, `schedule`, or non-literal argument anywhere in the artifact is refused whole, including valid rows beside it. One `rule` declaration is enough.

Rules register inference; they are not data. Do not return `(rule ...)`, `(ruleset ...)`, `(run ...)`, or a schedule.

The tool decides acceptance alone. This skill does not widen what the binary accepts.

## Turtle

Facts are already loaded by the host. Egglog does not parse Turtle. Do not emit Turtle, prefixes, or RDF triples in a claims artifact.
