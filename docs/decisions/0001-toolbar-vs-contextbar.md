# 0001 — Toolbar vs. contextbar: keep both, with distinct roles

- **Status:** Accepted
- **Date:** 2026-08-22
- **Context:** [issue #30](https://github.com/davide-bleggi/openPlan3D/issues/30)

## Problem

The editor has both a floating "contextbar" over the current selection and a
right-click context menu, and it was never settled which one owns what. The
question needed an answer before more UI was built on either.

## What we found

There were **two** contextbars, only one of them real:

- The shipping one is **inlined in `FloorPlanCanvas.svelte`** (the
  `<!-- Contextual Toolbar -->` block). It renders over the selected element
  and offers duplicate, a type-specific verb (door flip swing, wall split),
  and delete.
- `ContextToolbar.svelte` was a standalone **near-duplicate of that block that
  was never mounted**. It is imported by no file, and
  `git log -S "ContextToolbar" --all` returns no commit, so no import ever
  existed. Two copies of one surface, one of them silently dead.

Both were built mouse-first: 28×28 px buttons, below the ~44 px touch target
minimum. The context menu was worse — unreachable on touch entirely, because
the canvas calls `preventDefault()` on `touchstart`, which also suppresses the
browser's long-press → `contextmenu` synthesis.

## Decision

**Keep the toolbar and the contextbar, with distinct roles. Delete the dead
`ContextToolbar.svelte` duplicate** so the inline block is the single
definition of that surface.

The split is: **the contextbar carries a few high-frequency verbs for the
current selection; the context menu carries the full command set for whatever
is under the pointer; the properties panel edits fields.**

| Surface              | Role                                                                  | Trigger                                       |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| **TopBar**           | Document state: project, floors, undo/redo, export, save               | Always visible                                 |
| **BottomBar**        | View state — how the model is shown (grid, snap, rulers, zoom, fit)    | Always visible; plan-only controls hidden in 3D |
| **BuildPanel**       | Tool and insert palette                                                | Lateral island; collapses to its rail on phones |
| **Contextbar**       | ≤4 highest-frequency verbs on the current selection, one tap           | Something is selected, select tool, 2D plan     |
| **ContextMenu**      | The full command set for the element under the pointer                 | Right-click; long-press on touch                |
| **PropertiesPanel**  | Exhaustive editing of the selection — every field                      | Appears on selection                            |
| **AlignmentToolbar** | Multi-selection align/distribute, which needs no per-element context   | ≥2 elements selected                            |

The TopBar/BottomBar split (document state vs. view state) is already stated in
`BottomBar.svelte`; this record extends the same reasoning to the two
selection-scoped surfaces.

Why not consolidate the contextbar and the menu onto one:

- **The contextbar earns its place on touch.** One tap beats a 500 ms
  long-press for the verbs users repeat most, and it is the only surface that
  is visible without being summoned — it advertises what can be done.
- **The context menu earns its place too.** It reaches targets that have no
  selection bar (empty canvas, rooms) and holds the long tail — rotate, flip,
  lock, z-order, curve, hide wall, copy/paste, select all, zoom to fit — that
  would swamp a floating bar.

The cost of keeping both is that they can overlap, so the contextbar now hides
while the context menu is open.

## Consequences

- **Adding a command:** default to the context menu. Promote it to the
  contextbar only if it is among the few verbs used constantly for that
  element type, and only by replacing something.
- The contextbar stays capped at roughly four buttons. If it needs a fifth,
  that is a signal the command belongs in the menu instead.
- Both surfaces size their targets to ≥44 px on coarse pointers; the
  contextbar keys off `(pointer: coarse)`, the menu off being long-press-opened.
- Per-element commands are never added to `AlignmentToolbar` — it is for
  multi-selection geometry only, not a second contextbar.
