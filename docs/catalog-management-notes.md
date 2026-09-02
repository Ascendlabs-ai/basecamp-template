<!--
  MAINTAINER DOCUMENT — not part of the application.

  This records why one level of category nesting and the catalog admin screen
  that builds it exists and what was decided along the way, for
  whoever next touches it. Where the implementation ended up stronger than the
  design, the design text is corrected in place rather than left standing —
  a spec that disagrees with the code it shipped is worse than no spec.

  If you stamped this template, you can delete this file, exactly as you can
  delete MAINTAINING.md. Nothing in the app reads it.
-->

# Catalog management — one level of subcategories

**Status:** implemented, on top of the account-lifecycle work in
[`admin-user-management-notes.md`](admin-user-management-notes.md).

## What already existed

`/admin/catalog` could already create, rename, reorder and delete both
categories and entries, with slug generation, validation against every CHECK the
schema carries, and a delete that refuses when a category still holds entries.
That half needed no rework. Two things were missing: **subcategories**, and
proof-of-write on the two INSERT paths.

## What this adds

`basecamp.categories.parent_id` — a self-reference. NULL means top level; a
value means "a subcategory of that". Entries are untouched:
`entries.category_id` already points at any category row, so a tile sits in a
top-level category or a subcategory without a schema change.

## The depth cap, and why it is one level

**Why cap it.** Every reader of this table assumes a fixed shape. The home page
renders category → entries, the access matrix has a column per category, and
`category_has_grant()` answers a flat question. Arbitrary depth breaks each
differently — a grant that does not reach three levels down, a matrix wider than
the screen, a home page that recurses. One level is the depth the UI can draw and
the access model can express.

**Why the database enforces it.** A cap in the dialog is not a cap. This screen
writes straight from the browser on the caller's token, so anything the policy
permits is reachable from a console.

**Why a trigger and not a CHECK.** The rule is about *another row* — is my
parent itself a child? — and CHECK sees only the row being written. So
`basecamp.enforce_category_depth()`, `SECURITY DEFINER` with a pinned
`search_path`, for the reason `prevent_system_type_delete` already gives: only a
trigger can refuse with a message that says why.

**Both directions, and this is the part that is easy to get wrong.** Checking
only "is my parent a child?" lets a three-level tree be built bottom-up: create
A, create B under A, then give A a parent. Each row is legal in isolation; the
tree is not. The trigger therefore also refuses giving a parent to a category
that already has children. `boundary_mutations.sh` exercises both.

Self-parenting is a plain CHECK (`parent_id is distinct from id`), because that
one *does* only look at the row being written.

## No new grant, and that is the point

`authenticated` already held SELECT/INSERT/UPDATE/DELETE on
`basecamp.categories` from 0001, and the super_admin-scoped policies already
governed all four. `parent_id` is an ordinary column on a table whose access
model was already settled — so **adding a category, with or without a parent, is
decided by a policy rather than by a check in TypeScript**. Post-condition 4c in
0005 asserts nothing was widened.

## Deleting refuses; it does not cascade

Both foreign keys are `ON DELETE RESTRICT` — `entries.category_id` was already,
and `parent_id` matches it. A category is a container, and taking its contents
with it is never what somebody clicking delete on a container meant. Not `SET
NULL` either: silently promoting a subcategory to top level moves somebody's
content without saying so.

The UI counts entries *and* subcategories, and the tooltip names which is in the
way — "cannot delete" without that sends people looking in the wrong place.

## A refused write must not render as a success

RLS does not raise on UPDATE or DELETE. The policy filters the row away,
PostgREST answers `204`, and supabase-js yields `{ error: null }` — so a refused
delete renders as a completed one. **This repo has shipped that bug twice**, once
on grants and once on the trust root.

Every mutation therefore asks for the affected rows back and treats zero as "that
did not apply". The two INSERTs gained `.select("id")` in this change: RLS
*does* raise 42501 on a refused insert, so checking the error alone was already
correct there — but a reader should not have to know which of the four verbs is
the exception in order to trust the pattern.

`PART 14` of the shell suite checks the **row count**, not just the absence of an
error, for exactly this reason.

## Reads keep one shape

Both read paths were already `.from("categories")` with a nested select on the
caller's token — no RPC, so writes did not need a second shape. `parent_id` was
added to both selects, and grouping happens in `categoryTree()` in the tested
layer rather than in a query.

`categoryTree` deliberately renders a child whose parent is **not in the list**
at top level rather than dropping it. That is reachable for real: a subcategory
the viewer is granted, under a parent they are not. Dropping it would hide a row
the person is entitled to, which is the worse direction to be wrong in.

## Verification

`supabase/tests/boundary_mutations.sh` — the security gate; `npm test` is
convenience and never opens a database connection.

**PART 15** adds thirteen *mutation* cases that break the nesting guards one at a time
— cap disabled; cap gutted with the phrases the drift check looks for hidden in a
line comment, a block comment, and a string literal (three separate cases,
because the first fix caught only one variant and a review walked past it twice);
the upward half dropped; the downward half dropped; the parent lock removed;
either foreign key flipped to CASCADE; the self-parent CHECK dropped; the read
path narrowed back; the cap flipped to INVOKER; and a same-named decoy trigger on
another table — and require `0002` to refuse each. Without them `D20` ran on every case and had never been observed to
fail, which is the trap `0005` names when it deletes its own tautological
post-condition.

**PART 14** (runtime cases against a real session; `EXPECTED_RLS_CASES` 8 → 21):

- a non-admin cannot create a category, or an entry
- a non-admin's rename affects **zero rows** — checked by count, because RLS
  filters silently, and with the target made *readable* first so the SELECT
  policy cannot answer for the UPDATE policy
- a category a non-admin can see **survives** their delete. This one asserts the
  outcome rather than which guard produced it, and says so: a category is only
  readable by a non-admin when it holds something, and holding something is
  exactly what makes the foreign key refuse the delete — so the two guards
  cannot be separated here
- a category cannot be made **its own parent** — the case the trigger's two
  probes both pass on UPDATE, which is why the CHECK exists
- a granted viewer **can** read the parent of a subcategory they can see, and an
  empty category with no granted children **stays hidden**
- the depth cap refuses a third level, and refuses building one bottom-up
- deleting a category holding a subcategory, or an entry, is refused
- **two positive controls**: an administrator *can* create and nest, rename and
  delete — so a revoked grant turns the suite red rather than green

The refusal cases assert on the error *message*, not just the class: RLS refusal
and `permission denied for table` are both 42501, and a case that passed on a
missing grant would prove nothing. Verified by revoking
`insert on basecamp.categories` and confirming the cases go red.

**0002 mutations**, each confirmed refused: the cap disabled, the cap's upward
half gutted, either foreign key flipped to CASCADE, the cap flipped to
`SECURITY INVOKER`.

**One assertion had to change shape, and it is worth recording why.** 0002
asserted a trigger *floor* (`n < 16`). Adding 0005's depth cap took the real
count to 17, which handed the floor slack to absorb a dropped trigger — with the
floor unchanged, the suite's existing "a trigger was dropped" case **committed**.

The first fix was to make the floor migration-aware (16 before 0005, 17 after,
keyed off `categories.parent_id`). That was a bandaid: a bespoke probe per
migration, migration ORDER compiled into the file whose job is asserting
invariants, and `drop column parent_id` would have silently disabled it.

It is now a **named set**, the pattern already used in that file for the four
audit writers and the three TRUNCATE guards. A named set cannot be satisfied by
slack, needs no arithmetic, and never quietly stops checking.

## The read model had to learn about nesting too

`category_has_grant()` opens with "does this category hold at least one entry of
its own". Before nesting that was complete. After it, the arrangement this
feature exists for — a parent used purely as a container — holds none, so the
parent was invisible while its child was visible, and the client received a
`parent_id` naming a row it could not read.

`0005` adds `category_or_child_has_grant()`: true when the viewer can see a tile
in this category **or in one of its direct subcategories**. Bounded by the depth
cap — one join, no recursion — and a definer, because a policy on
`basecamp.categories` that reads `basecamp.categories` recurses against its own
RLS.

**What this does not widen.** The original rule exists so a grant on an *empty*
category cannot disclose its name and description to somebody who can see
nothing inside it. That is untouched and is asserted by its own runtime case: a
category with no entries and no granted children is still invisible. What is
added is narrower — a parent becomes visible when the viewer can already see a
tile inside it. `visibleCategories` carries the same rule client-side, with
tests for both directions.

## Two consequences worth knowing

**Grants are flat.** `category_has_grant()` does not walk the tree, so granting
a parent grants nothing about its subcategories. That is why the cap exists at
all — the access model is flat — and making grants inherit would change what
every existing grant means. Left as a deliberate decision, recorded in
`issues.md`, with the access matrix labeling subcategories by parent so the
flatness is at least legible.

**`CatalogView` decides `nested` at the flatten, not from `category.parent_id`.**
Those two can still disagree — a subcategory whose parent this viewer cannot
see is promoted to a root by `categoryTree` — and reading `parent_id` there
rendered an indented `<h3>` under an unrelated `<h2>`: a broken document outline
in the component whose comments claim to protect it. One decision, one place.

## Out of scope

- **Grants that inherit.** Recorded in `issues.md` as a decision, not a gap.
- Reordering across parents by dragging. Moving a category between parents is
  done from its edit form, not by dragging it in the list.
- More than one level, permanently — see the cap's reasoning above.
