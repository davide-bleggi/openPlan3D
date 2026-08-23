# 0002 — Cross-device sync: a file someone else syncs, not a cloud of ours

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** [issue #29](https://github.com/davide-bleggi/openPlan3D/issues/29)

## Problem

Projects lived only in the browser's localStorage. A plan drawn on the laptop
was on the laptop, full stop — there was no way to carry it to the desktop
short of exporting JSON by hand and importing it on the other side. The
deployment is stateless (`adapter-node`, `DynamicUser=yes`), so there was
nowhere on the server to put a project even if we wanted to.

## Decision

**A project can be backed by a single JSON file. The app autosaves into that
file and reads it back when the project is reopened. Getting that file onto
another device is somebody else's job** — iCloud Drive, Dropbox, OneDrive,
Syncthing, a network share. The user puts the file in a folder one of those
already watches, and cross-device editing falls out of it.

What we are explicitly *not* building: server-side storage, accounts, an
in-app cloud, or a sync protocol. The file is the whole contract.

The file is plain project JSON — the same shape `Export → Download JSON`
produces, so it stays importable by hand — with one added key,
`openplanSync`, carrying `{ revision, deviceId, savedAt }`.

## How it holds together

`showSaveFilePicker` / `showOpenFilePicker` give us a `FileSystemFileHandle`,
which is structured-cloneable but not JSON-serializable, so the per-project
link lives in **IndexedDB** (`openplan-project-files`), not localStorage. Write
permission lapses when the tab closes and re-granting it needs a user gesture,
which is why a reconnect button exists rather than a silent retry.

Writes ride the existing 5-second autosave debounce. While the editor is open
the file is re-checked every 15 seconds and on tab focus, so a copy arriving
from another device is noticed without the user doing anything.

## Not losing work

Two devices can write the same file, and a sync service can hand back a copy
that is *older* than what we have. The policy lives in one pure function,
`decideSync` in `src/lib/utils/projectFileSync.ts`, over three inputs — what we
knew about the file at our last sync, what is in it now, and whether we hold
unsynced edits:

| File since our last sync | We have edits | Verdict     |
| ------------------------ | ------------- | ----------- |
| unchanged                | no            | nothing to do |
| unchanged                | yes           | write       |
| newer revision           | no            | adopt it    |
| newer revision           | yes           | **ask**     |
| older revision           | either        | **ask**     |

A write only ever goes out over a file that is where we left it. Anything else
stops and puts both versions to the user, who keeps theirs or takes the file's;
taking the file's parks the discarded edits in version history first.

**Dirtiness is a content fingerprint, not a timestamp.** Timestamps look like
the obvious signal and are the wrong one: device clocks disagree, so a project
pulled from a machine running a minute fast would make every later local edit
look older than the sync — and therefore clean, and therefore safe to
overwrite. `projectSignature` hashes the serialized project instead, which has
no opinion about whose clock is right.

## Fallback

Safari on iOS and iPadOS has no file picker of this kind, and that is not a
small share of the users. There, the feature detects as unsupported and the
panel says so, pointing at `Download JSON` / `Import JSON` — the manual version
of the same idea. Everything else in the app is unchanged: localStorage remains
the primary store on every browser, and the file is a second copy, never the
only one.
