# Nucleus Package Files Are Read-Only

Files installed by nucleus and tracked in `nucleus.manifest.json` under `"category": "package"` blocks are **read-only** in this repository.

## What this means

You may import from and use any nucleus-managed package (e.g., `packages/shared/`, `packages/@core/identity/`). You must **not** modify, edit, write, or delete any file that appears in the `files` map of a package block in `nucleus.manifest.json`.

## If a bug or change is needed

All changes to nucleus packages must originate in the **nucleus repository** — the canonical source of truth. The workflow is:

1. Open a PR or issue against the nucleus repository with the required fix or enhancement.
2. Once merged, run `nucleus update` in this repository to pull in the updated files.

Editing a nucleus-managed file directly will put this repository out of sync with the nucleus source, break future updates, and corrupt the manifest integrity hashes.

## How to identify nucleus-managed files

Open `nucleus.manifest.json` at the project root. Any file path listed under a block where `"category": "package"` is nucleus-managed and off-limits for direct edits.
