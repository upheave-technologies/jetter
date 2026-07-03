---
name: changelog
description: "Generate or update CHANGELOG.md from git tags. Release notes style — short tagline per version, human-readable bullet points."
---

# Changelog — Release Notes Generator

Generates or updates `CHANGELOG.md` at the project root from `cli-v*` git tags. Each tag is a release. Commits between tags are rewritten into release-notes-style entries that read naturally to both technical and non-technical users.

---

## Invocation

- `/changelog` — update CHANGELOG.md with new versions since last documented
- `/changelog full` — regenerate the entire CHANGELOG.md from scratch
- `/changelog {version}` — generate entry for a specific version only (e.g., `/changelog 0.2.6`)

---

## Tag Convention

- Tags are prefixed with `cli-v` (e.g., `cli-v0.2.5`)
- Display versions WITHOUT the prefix (e.g., `v0.2.5`)
- Tags are the source of truth for what constitutes a release

---

## Workflow

```
1. git tag -l "cli-v*" --sort=version:refname          # discover all versions
2. Read CHANGELOG.md if it exists                        # find last documented version
3. For each undocumented version:
   a. git log --oneline {prev_tag}..{tag}               # get commits in range
   b. Skip "chore: bump nucleus CLI" commits             # mechanical, not changelog-worthy
   c. Rewrite remaining commits into release note entries
4. Write/update CHANGELOG.md                             # newest version first
```

For the first tag (no previous tag), use `git log --oneline {tag}` to get all commits up to that tag.

For unreleased changes, use `git log --oneline {latest_tag}..HEAD`.

---

## Output Format

Release notes style — NOT Keep a Changelog categories. Each version gets a **bold tagline** that captures the theme of the release, followed by bullet points.

```markdown
# Nucleus CLI Release Notes

## v0.2.6

**ORM-agnostic agents + project context enrichment**
- All 8 agents are now ORM-agnostic — removed hardcoded Prisma from archie and Drizzle from donnie
- Introduced project context enrichment convention: agents read tech-context.md for the project's stack
- Renamed ai-agent preset to agents for clarity

## v0.2.5

**Bug fix: hook script permissions**
- Fixed .sh files installed by the CLI not receiving executable permissions — hooks were non-functional in consuming projects
```

---

## Writing Style

### The tagline
- Short phrase capturing the theme of the release (2-6 words)
- Bold, on its own line after the version header
- Examples: "Hook system overhaul", "Import hygiene", "Bug fix: hook script permissions"

### The bullet points
- Written as natural sentences, not raw commit messages
- Start with a verb (Added, Fixed, Introduced, Eliminated, Renamed)
- Explain WHAT changed and WHY it matters — a user should understand the impact
- Use em dashes for inline clarifications (e.g., "— hooks were non-functional in consuming projects")
- Use backticks for commands, file names, and code references
- Combine related commits into a single entry when they're part of the same change
- Omit purely mechanical commits (version bumps, trivial chores)

### Rewriting examples

Bad (raw commit): `feat: add reinitialize and update-preset CLI commands`
Good (release note): `Added nucleus reinitialize command — wipe and re-scaffold a project from scratch`

Bad (raw commit): `refactor: eliminate barrel imports in favor of direct source imports`
Good (release note): `Eliminated all barrel imports (index.ts re-exports) in favor of direct source imports — every import now points to the file where the code lives`

---

## Rules

1. **Newest first.** Most recent version at the top.
2. **No date in headers.** Version headers use `## v0.2.6` format, not `## [0.2.6] — 2026-03-27`.
3. **One tagline per version.** Bold, thematic, concise.
4. **Preserve existing entries.** When updating (default mode), only add NEW versions not already in the file. Never rewrite or reformat existing entries.
5. **No categories.** Don't use `### Added`, `### Fixed` sub-headers. All entries are flat bullet points under the tagline.
6. **Combine related commits.** If 3 commits are all part of the same feature, write one or two bullet points, not three.
7. **File location.** `CHANGELOG.md` at the project root.
