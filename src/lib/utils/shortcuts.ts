import { selectedTool, undo, redo, viewMode, selectedElementId, selectedElementIds, removeElement, panMode, beginUndoGroup, endUndoGroup, setActiveTool, nudgeElements, clipboardStore, copySelectionToClipboard, pasteClipboard } from '$lib/stores/project';
import { nudgeDelta, nudgeDirection, nudgeStep } from '$lib/utils/nudge';
import { get } from 'svelte/store';
import { localStore } from '$lib/services/datastore';
import { currentProject } from '$lib/stores/project';

/** The selection the single-key shortcuts act on: the multi-select when it is
 *  non-empty, otherwise the single selection, or null when nothing is picked. */
function selectedIds(): Set<string> | null {
  const multi = get(selectedElementIds);
  if (multi.size > 0) return multi;
  const single = get(selectedElementId);
  return single ? new Set([single]) : null;
}


/** True when the user has text highlighted on the page. */
function hasTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.getSelection()?.toString().trim().length ?? 0) > 0;
}

export interface ShortcutContext {
  rotateFurniture?: () => void;
  save?: () => void;
}

export function handleGlobalShortcut(e: KeyboardEvent, ctx: ShortcutContext = {}): boolean {
  const mod = e.metaKey || e.ctrlKey;

  // Ctrl+Z undo
  if (mod && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
    return true;
  }
  // Ctrl+Y or Ctrl+Shift+Z redo
  if ((mod && e.key === 'y') || (mod && e.key === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
    return true;
  }
  // Ctrl+S save
  if (mod && e.key === 's') {
    e.preventDefault();
    if (ctx.save) ctx.save();
    else {
      const p = get(currentProject);
      if (p) localStore.save(p);
    }
    return true;
  }

  // Don't handle single-key shortcuts if user is typing in an input
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;

  // Copy / paste of plan elements (issue #22). Both sit below the form-field
  // guard above, so editing a name or a dimension keeps the browser's own
  // copy and paste.
  if (mod && (e.key === 'c' || e.key === 'C') && !e.shiftKey && !e.altKey) {
    // Text selected on the page is what the user meant to copy — a plan
    // selection is not worth stealing Ctrl+C from a highlighted room name.
    if (hasTextSelection()) return false;
    const ids = selectedIds();
    if (!ids) return false;
    if (copySelectionToClipboard(ids) === 0) return false;
    e.preventDefault();
    return true;
  }
  if (mod && (e.key === 'v' || e.key === 'V') && !e.shiftKey && !e.altKey) {
    // Nothing of ours to paste: leave the event alone so the canvas's own
    // handler can still take an image off the system clipboard.
    if (!get(clipboardStore)) return false;
    e.preventDefault();
    pasteClipboard();
    return true;
  }

  // Arrow keys nudge the selection along the plan axes (issue #21). Held down
  // they auto-repeat, which is the point: a run of presses is one undo entry.
  const dir = nudgeDirection(e);
  if (dir) {
    const ids = selectedIds();
    if (!ids) return false;   // nothing selected — let the page scroll
    e.preventDefault();
    const d = nudgeDelta(dir, nudgeStep(e));
    nudgeElements(ids, d.x, d.y);
    return true;
  }

  if (e.key === 'Escape') {
    setActiveTool('select');
    selectedElementId.set(null);
    selectedElementIds.set(new Set());
    return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const multiIds = get(selectedElementIds);
    if (multiIds.size > 0) {
      beginUndoGroup();
      for (const id of multiIds) removeElement(id);
      endUndoGroup();
      selectedElementIds.set(new Set());
      selectedElementId.set(null);
    } else {
      const id = get(selectedElementId);
      if (id) { removeElement(id); selectedElementId.set(null); }
    }
    return true;
  }
  // Past this point the shortcuts are bare letters, so a modifier means the
  // press belongs to the browser or to a shortcut handled above — Ctrl+V with
  // an empty clipboard must not fall through and switch to the select tool.
  if (mod) return false;

  if (e.key === 'w' || e.key === 'W') { setActiveTool('wall'); panMode.set(false); return true; }
  if (e.key === 'd' || e.key === 'D') { setActiveTool('door'); panMode.set(false); return true; }
  if (e.key === 'v' || e.key === 'V') { setActiveTool('select'); panMode.set(false); return true; }
  if (e.key === 'h' || e.key === 'H') { panMode.set(true); return true; }
  if (e.key === 't' || e.key === 'T') { setActiveTool('text'); panMode.set(false); return true; }
  if (e.key === 'r' || e.key === 'R') {
    if (ctx.rotateFurniture) ctx.rotateFurniture();
    return true;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const m = get(viewMode);
    viewMode.set(m === '2d' ? '3d' : '2d');
    return true;
  }
  if (e.key === 'g' || e.key === 'G') {
    // Handled in canvas component
    return false;
  }
  return false;
}
