---
name: infra-bootstrap
description: "Install the Nucleus Stack Kit into a new Nucleus-based project. Idempotent — safe to run on a freshly cloned repo or to repair a partial installation. Invoke when the user is starting a new project, when infra/_kit/ is missing or partial, or when porting a different project to the standard convention."
---

# /infra-bootstrap — Install the Kit Into a New Project

You install or repair the Nucleus Stack Kit so that **every Mario project has the same operator surface**. Uniformity is non-negotiable. The kit's promise — "`stack up` works the same in every repo" — collapses the moment one project diverges.

---

## Invocation

| Command | Action |
|---|---|
| `/infra-bootstrap` | Diagnose the current repo and propose changes |
| `/infra-bootstrap install` | Run the install plan after the user reviews it |
| `/infra-bootstrap install --profile <vps\|cloud\|hybrid>` | Install with a specific deploy profile |
| `/infra-bootstrap repair` | Fix drift (kit files modified or missing) |
| `/infra-bootstrap verify` | Confirm the kit is correctly installed and `stack` works |

---

## The three profiles

Pick once per project. The choice drives which files are installed and which CI/CD pipeline is wired.

### Profile: `vps`

For self-hosted projects (Docker Compose on a Hetzner / DigitalOcean / Hetzner VPS, behind Caddy). The classic Nucleus VPS shape.

Installs:
- `infra/_kit/` (kit)
- `infra/docker-compose.yml` (minimal, DB-only)
- `infra/docker-compose.dev.yml` (full stack)
- `infra/docker-compose.vps.yml` (prod stack)
- `infra/Dockerfile.<app>` (multi-stage)
- `infra/Caddyfile.dev` + `Caddyfile.prod`
- `infra/ansible/` (provision.yml + 5 roles + vault template)
- `infra/.env.example` + `apps/<app>/.env.local.example`
- `infra/projects.{dev,prod}.yaml` (only if the project has a data manifest concept)
- `.github/workflows/deploy.yml`
- `infra/tunnel.sh`

### Profile: `cloud`

For Vercel + Neon projects. No VPS, no Ansible.

Installs:
- `infra/_kit/` (kit, minus the VPS-specific pieces)
- `apps/<app>/.env.local.example`
- `infra/.vercel/` skeleton (linked via `vercel link`)
- `infra/neon-branches.md` (documents the branch-DB convention)
- `.github/workflows/preview.yml` (preview-deploy aware: lints, runs tests, creates Neon branch)
- The kit's `stack triage cloud` subcommand is enabled
- Local dev still uses Docker Compose for Postgres (so AI test scenarios don't burn Neon quota)

### Profile: `hybrid`

When the project has a Vercel-deployed surface AND a VPS-deployed microservice (e.g., a background worker). Installs both stacks side-by-side. Rare; ask the user to confirm before choosing this.

---

## Diagnose protocol (read-only)

Run when the user says `/infra-bootstrap` (no subcommand):

1. Check for existing files:
   - `infra/` exists? `infra/_kit/manifest.yaml` exists? Hash matches the kit's bundled hash?
   - Compose files exist? Caddyfiles exist? Dockerfile exists?
   - `.github/workflows/deploy.yml` or `preview.yml` exists?
   - `apps/<app>/.env.local.example` exists?

2. Detect deployment shape:
   - Is there a `.vercel/project.json`? → `cloud`
   - Is there an `infra/ansible/` with provision.yml? → `vps`
   - Both? → `hybrid`
   - Neither? → ask the user

3. Detect drift:
   - Kit files modified locally vs. the bundled hash → `repair` candidate
   - Compose files reference non-standard paths (e.g., compose file isn't named `docker-compose.dev.yml`) → flag

4. Output a plan:

```markdown
## Bootstrap Plan for <repo>

**Detected profile:** vps  (inferred from infra/ansible/ presence)
**Detected app:** apps/core (from package.json workspaces)
**Kit version installed:** 0.0.0 (not installed)

**Will install:**
- infra/_kit/ (kit)               ← NEW
- infra/docker-compose.dev.yml      ← NEW
- infra/Caddyfile.dev               ← NEW
- ...

**Will skip (already present, no drift):**
- infra/Dockerfile.core              ✓ matches expected pattern

**Will repair (drift detected):**
- infra/.env.example                 ⚠ missing OPS_ALERT_SLACK_USER_ID — will add to template

**Will NOT touch:**
- apps/core/.env.local               (gitignored; never overwritten)
- infra/ansible/group_vars/all/vault.yml (encrypted; never overwritten)

**Estimated time:** 30 seconds
**Reversible:** yes — every change is in a single commit you can `git revert`

Proceed? Type "install" to run.
```

---

## Install protocol

Triggered by `/infra-bootstrap install`. Steps:

1. **Snapshot** the working tree with a `git stash` if there are uncommitted changes (user is told and confirms).
2. **Create the kit directories:**
   ```
   infra/_kit/{bin,lib,seeds,templates,fixtures}
   .claude/skills/{infra,infra-seed,infra-port-doctor,infra-rotate-secret,infra-prod-triage,infra-cloud-triage,infra-bootstrap,infra-dashboard}
   .claude/agents/   # (already exists in Nucleus repos)
   ```
3. **Copy the kit files** from the kit's bundled `templates/` into the target paths. Substitute placeholders:
   - `__APP_NAME__` → the package name in `apps/<app>/package.json`
   - `__APP_SLUG__` → kebab-cased name (`demoapp-core` → `demoapp`)
   - `__DOMAIN__` → asked from user (e.g., `your-app.example.com`); for `cloud` profile, this is the `vercel.app` domain
   - `__DEFAULT_PROFILE__` → `vps` / `cloud` / `hybrid`
4. **Write `infra/_kit/manifest.yaml`** with the chosen profile, kit version, and project metadata.
5. **Write `infra/.gitignore`** entries for the kit:
   ```
   infra/.env
   infra/.ports
   infra/.stack/
   ```
6. **Write `.claude/agents/infra.md`** (copies the bundled agent).
7. **Write the 8 skill files** (copies the bundled skills).
8. **Update `CLAUDE.md`** — append the agent to the Agent Roster, append the skills to the Available Skills list. Idempotent edits — only adds rows that aren't already there.
9. **Run `stack doctor`** to verify the install.
10. **Print** the post-install report with the canonical first-run commands.

---

## What you ask the user before installing

Minimal — most things can be inferred. But these three need explicit answers:

1. **Profile:** `vps` / `cloud` / `hybrid`?
2. **Production domain:** for `vps`, the public hostname (e.g., `your-app.example.com`); for `cloud`, the Vercel custom domain or `*.vercel.app`.
3. **App slug:** short name used for compose project, container, dashboard label. Defaulted from package.json but confirm.

For `vps`, also ask:
4. Does this project need GitHub App webhooks? (drives the .env shape and webhook docs)
5. Does it need Slack? (same)

For `cloud`:
4. Neon project ID (or "I'll wire it later")
5. Vercel org/project ID (or run `vercel link` automatically)

---

## Repair protocol

Triggered by `/infra-bootstrap repair`. When the kit is installed but drifted:

1. **Diff each kit file** against the bundled version.
2. **For each drift:**
   - If the file was customized for the project (e.g., `docker-compose.dev.yml` has project-specific env vars) — leave it, but warn.
   - If the file is supposed to be identical (e.g., `bin/stack`, `lib/*.sh`) and has drifted — **show the diff** and ask the user whether to overwrite.
3. **Never silently overwrite** customizations. Every divergence is presented to the user.

Repair never drops the user's data. Compose volumes, env files, vault.yml are untouched.

---

## Verify protocol

```bash
/infra-bootstrap verify
```

Runs:
1. `infra/_kit/bin/stack doctor` — confirms docker, ports, env files, kit version.
2. Confirms every expected file exists at the right path.
3. Confirms every expected `.claude/skills/infra-*` skill is registered in `CLAUDE.md`.
4. Confirms `infra/_kit/manifest.yaml` matches the kit version.
5. Outputs a single PASS/FAIL with the failing files (if any).

Use this after every kit update (`nucleus update` will eventually own this).

---

## Step 10 — Optional: shell integration

After the kit itself is installed, **ask the user**:

> "The kit ships a shell function that lets you type `stack` from any subdirectory of any stack-equipped project, auto-discovering the right kit per cwd. It works by appending one line to your shell rc:
>
> ```
> [[ -f ~/.stack/shell-integration.sh ]] && source ~/.stack/shell-integration.sh
> ```
>
> Would you like me to:
> **(a)** Copy `infra/_kit/shell-integration.sh` to `~/.stack/` AND append the one line to your `~/.zshrc` (detected) — I will show the exact line and wait for your `yes` before editing,
> **(b)** Copy the file to `~/.stack/` but NOT touch your rc — I will print the snippet for you to paste yourself,
> **(c)** Skip entirely — you can run `stack install-shell` later if you change your mind."

Defaults: **(b)** is the safe default if the user is hesitant. Never silently choose **(a)**.

Detect the shell from `$SHELL` or fall back to checking which rc files exist:
- `bash` → `~/.bashrc` (Linux) or `~/.bash_profile` (macOS interactive)
- `zsh` → `~/.zshrc`
- `fish` → `~/.config/fish/config.fish` (the function form differs — print a fish-compatible snippet)

If the user picks **(a)**:
1. Show the literal line you will append + the literal path you will write to.
2. Wait for explicit `yes`.
3. `mkdir -p ~/.stack && cp infra/_kit/shell-integration.sh ~/.stack/`
4. Idempotency check: `grep -q 'stack/shell-integration.sh' <rc>` first. If present, report "already wired" and skip the append.
5. Append the line with a leading comment so it's identifiable later:
   ```
   # Nucleus Stack Kit shell integration — see ~/.stack/shell-integration.sh
   [[ -f ~/.stack/shell-integration.sh ]] && source ~/.stack/shell-integration.sh
   ```
6. Tell the user to `source ~/.zshrc` or open a new shell.

If the user picks **(b)**: do steps 3 only; print the rc line for them to paste.

If **(c)**: do nothing — continue to the post-install instructions.

---

## Cardinal rule — never modify local machine config without confirmation

This skill's authority to write files extends to:
- The project tree (anything under `<repo>/`)
- `~/.stack/` (the kit's per-user state dir, including `shell-integration.sh` once the user has authorised step 10)

This skill's authority does **NOT** extend to (without explicit per-action confirmation):
- `~/.zshrc`, `~/.bashrc`, `~/.profile`, `~/.zshenv`, `~/.bash_profile`, or any other shell rc
- `~/.config/`, `~/Library/`, `~/.ssh/`, `~/.gitconfig`
- `/etc/hosts` or any other system file
- The system keychain / trust stores (the user runs `mkcert -install` themselves)
- Installing packages globally (`brew`, `apt`, `npm -g`, `pip --user`)

If any step in the install plan touches one of those paths, the plan **must** declare it up-front, show the user the exact diff, and wait for explicit `yes`. This rule is non-negotiable and inherited from the agent's Commandment Three.

---

## Post-install instructions for the user

After a successful install, print:

```markdown
## Kit installed (profile: <vps>)

**Try it:**
1. `cp infra/.env.example infra/.env`           # then fill in your dev secrets
2. `infra/_kit/bin/stack install-shell`       # optional — adds `stack` to your PATH (asks before editing rc)
3. `infra/_kit/bin/stack doctor`              # confirms environment
4. `infra/_kit/bin/stack up`                  # boots the local stack
5. Open http://localhost:42137                  # cross-project dashboard

**For VPS deploy:**
5. `cd infra/ansible && cp inventory.yml.example inventory.yml`  # add your VPS IP
6. `cp group_vars/all/vault.yml.example group_vars/all/vault.yml`
7. Fill in vault values; `ansible-vault encrypt group_vars/all/vault.yml`
8. `ansible-playbook provision.yml --ask-vault-pass`           # first-time provisioning

**Routine ops:** invoke the agent → `infra`.
**Skills:** `/infra`, `/infra-seed`, `/infra-port-doctor`, `/infra-rotate-secret`, `/infra-prod-triage`, `/infra-cloud-triage`, `/infra-dashboard`, `/infra-bootstrap`.

**Read:** `infra/_kit/AGENT.md` for the full reproduction + triage manual (ships inside the kit).
```

---

## What this skill does NOT do

- ❌ Modify production state. This is a local-only install.
- ❌ Decide deploy profile silently. The user picks.
- ❌ Overwrite gitignored files (the user's secrets, vault.yml).
- ❌ Auto-commit. After install, the user reviews `git status` and commits.

---

## Self-check

- [ ] Did I run the diagnose pass first?
- [ ] Did the user see and approve the install plan?
- [ ] Did I substitute `__APP_NAME__`, `__APP_SLUG__`, `__DOMAIN__` everywhere?
- [ ] Did I update `CLAUDE.md` idempotently?
- [ ] Did `stack doctor` PASS post-install?
- [ ] Did I print the post-install instructions?
