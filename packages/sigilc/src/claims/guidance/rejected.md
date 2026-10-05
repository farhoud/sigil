# Rows the tool refuses

- A handle the brief did not issue, such as f90 in a brief ending at f81.
- A rule, command, schedule or non-literal argument: the whole artifact goes.
- A wrong column count, an unknown relation, or another modality.
- A row that carries a contract role, or a step named other than by ordinal.
- A guard operand other than `state`, `input` or `constraint`.
- An ungrounded name, a name outside the closure, or a declared Component or
  Tag.
- A claim whose subject is its object.

Not refused, but wrong: a deduced claim, such as the panel `dependsOn` the
service when the Facet only says it shows results; a `to` edge read from "then".
