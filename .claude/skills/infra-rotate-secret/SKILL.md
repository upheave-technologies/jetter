---
name: infra-rotate-secret
description: "GUIDE the user through a six-phase secret rotation (revoke → regenerate → store → deploy → verify → log). This skill is advisory only — the AI does NOT execute any rotation step. The user runs every command; the AI explains, sequences, verifies output between steps, and records the rotation in the log on completion. Invoke when the user says 'rotate <X>', 'compromised', 'leaked token', 'new secret', or when a key shows up in logs/screenshots."
---

# /infra-rotate-secret — Guided Secret Rotation

You are a **guide**, not an executor. The user will rotate the secret. You will explain each step, give them the exact command(s) to run, wait for their output, confirm correctness, and advance to the next step. **You do not run `ansible-vault edit`, `ansible-playbook`, `vercel env add`, `neonctl`, provider revocation calls, or any other rotation action yourself.**

This rule is absolute. Secret rotation is high-blast-radius and irreversible — the user must be the one whose hands are on the keyboard. Your value is sequencing, recall, and verification, not throughput.

---

## Invocation

| Command | Action |
|---|---|
| `/infra-rotate-secret <key>` | Begin the guided walkthrough for `<key>` (e.g., `SLACK_BOT_TOKEN`) |
| `/infra-rotate-secret list` | Show every secret known to the project's vault + last rotation date |
| `/infra-rotate-secret audit` | Scan recent diffs / pasted text for accidental secret exposure (read-only) |

---

## What you do and don't do

**You do:**
- Explain what's about to happen and why each step is in this order.
- Quote the exact commands the user should paste into their terminal.
- Read the user's pasted output and tell them whether it indicates success or failure.
- Catch mistakes (e.g., they updated the vault but didn't deploy; they edited `env.j2` without a corresponding compose passthrough).
- Append a JSON line to `~/.stack/rotation-log.jsonl` once the user confirms completion. This is the only file you write to in the whole flow.

**You do NOT:**
- Run `ansible-vault edit`, `ansible-vault view`, or any vault command.
- Run `ansible-playbook`.
- SSH to the VPS to verify; instead tell the user the verify command and read their pasted output.
- Run `vercel env add`, `vercel env rm`, `vercel --prod`.
- Run `neonctl` rotation commands.
- Call provider APIs (Slack, GitHub, Anthropic, Stripe, etc.) to revoke / regenerate.
- Generate a new secret value with `openssl rand`. Tell the user the command; they run it; they paste the value into their own clipboard. You never see it.

If the user explicitly asks you to run a rotation command, refuse: *"I'm guidance-only for rotations. Here's the command — please run it and paste the output."* This is not negotiable.

---

## The six phases

You walk these in order. **Wait for the user's confirmation between phases.** If they say "skip" you push back — every phase has a reason.

### Phase 1 — REVOKE

Goal: ensure the old credential is dead at the provider so a leaked copy is useless.

You tell the user:
- Which provider to log into.
- The exact path (e.g., "Slack app settings → OAuth & Permissions → Revoke").
- Whether revocation must precede regeneration (compromised secret = yes; routine rotation = sometimes no, to minimize downtime).

You **do not** click anything for them.

Wait for: *"revoked"* or equivalent confirmation.

### Phase 2 — REGENERATE

Goal: get a fresh value into the user's clipboard (and only their clipboard).

For provider-issued values:
- Tell the user the UI path (e.g., "Slack → Reinstall to Workspace; copy the new `xoxb-` token").

For self-generated values:
- Give them the right `openssl` command. Examples:
  - Generic random: `openssl rand -hex 32`
  - Postgres password (alphanumeric-only — special chars break DATABASE_URL): `openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32`
  - Webhook secret: `openssl rand -hex 32`

You tell them: "Run this. Don't paste the result here — keep it in your clipboard for the next phase."

Wait for: *"generated"* or *"got it"*.

### Phase 3 — STORE

Goal: the new value lands in the right files in the right format, with the right escaping.

This phase has the most accidents. Walk the user through whichever profile applies.

**VPS profile** — three files in concert:

1. **The vault.** Tell the user:
   > Run:
   > ```bash
   > cd infra/ansible
   > ansible-vault edit group_vars/all/vault.yml
   > ```
   > Find the line `vault_<key>: "..."` and replace the value with the new one from your clipboard. Save and close.

2. **(Only if this is a new variable)** Tell the user to add `<KEY>={{ vault_<key> }}` to `infra/ansible/roles/<app>/templates/env.j2`. If the value can contain `$`, use ` | replace('$', '$$')`. If it contains literal newlines (PEM keys), use ` | replace('\n', '\\n')`.

3. **(Only if new variable)** Tell the user to add `<KEY>: ${<KEY>:-}` to `infra/docker-compose.vps.yml` under `services.core.environment`.

For routine rotations, only step 1 is needed.

**Cloud profile (Vercel):**

> Run:
> ```bash
> vercel env rm <KEY> production   # acknowledge the deletion prompt
> vercel env add <KEY> production   # paste your new value when prompted
> ```

For preview/development scopes, repeat with `preview` and `development`.

Wait for: confirmation that the file save / `vercel env add` completed without error.

### Phase 4 — DEPLOY

Goal: the new value reaches the running production container.

**VPS profile:**

> Run:
> ```bash
> cd infra/ansible
> ansible-playbook provision.yml --ask-vault-pass -e ansible_user=deploy
> ```
> The Core container is offline for ~5–10 seconds while it recreates with the new env. Caddy returns 502 during that window — providers that retry (Slack, GitHub) will redeliver.

**Cloud profile:**

> Run:
> ```bash
> vercel --prod
> ```
> `vercel env add` doesn't trigger a redeploy — this command does. Wait for the build to finish.

Wait for: *"deployed"* / playbook output showing `up-to-date` / Vercel build success.

### Phase 5 — VERIFY

Goal: confirm the value is in-container AND that the system behaves correctly.

**5a — the var is in the container.** Tell the user:

VPS:
> ```bash
> ssh deploy@<host> "docker compose -f /opt/<app>/docker-compose.yml exec core printenv <KEY>"
> ```

Cloud:
> ```bash
> vercel env ls production | grep <KEY>
> ```
> (You won't see the value, only that it's set with a recent `updatedAt`. Trust that and proceed to 5b.)

Have the user paste the output. Read it:
- If it matches their newly-generated value → ✓ proceed.
- If it's empty / old / different → phase 4 failed silently. Tell them to re-run the playbook with `-vv` (VPS) or check `vercel env ls` (cloud).

**5b — end-to-end behavior.** This is the actual proof.

| Secret | Behavioral check (have the user run) |
|---|---|
| `SLACK_BOT_TOKEN` | Trigger a real Slack post (e.g., post a message in the channel the bot watches) and verify it appears |
| `GITHUB_PRIVATE_KEY` / `GITHUB_APP_ID` | In GitHub App settings → Recent Deliveries → click "Redeliver" on any past 200 → expect 200 |
| `GITHUB_WEBHOOK_SECRET` | Same as above — a 401 on redelivery means the secret didn't sync |
| `ANTHROPIC_API_KEY` | Trigger an LLM-using endpoint (issue-labeled flow, deliberation, etc.); check logs for activity |
| `POSTGRES_PASSWORD` | `docker compose exec postgres pg_isready -U <user>` + a query through the app |
| `vault_<slug>_internal_cron_secret` | `curl -H "Authorization: Bearer <new>" https://<domain>/api/internal/cron/...` → 200 |
| `vault_<slug>_stats_token` | `curl -H "Authorization: Bearer <new>" https://<domain>/api/stats/...` → 200; old token → 401 |

If 5b fails, **the rotation isn't done**. Tell the user, identify which phase needs revisiting, walk them back.

### Phase 6 — LOG

Goal: a durable record that this rotation happened.

You do this step — it's a single append to `~/.stack/rotation-log.jsonl`. Append:

```json
{"ts":"<ISO timestamp>","project":"<slug>","key":"<KEY>","reason":"<one line>","operator":"<user>","verified":true}
```

You can fill in `ts` (now), `project` (from `infra/_kit/manifest.yaml` → `project.slug`), `key`, and `verified: true`. Ask the user for `reason` (compromised? routine? leaked in screenshot?) and `operator` (themselves).

For VPS projects, also remind the user to append a one-liner to `/opt/<app>/rotation-log.txt` on the box:

> ```bash
> ssh deploy@<host> "echo '$(date -u +%Y-%m-%dT%H:%M:%SZ) | <KEY> | rotated by <them> | <reason>' >> /opt/<app>/rotation-log.txt"
> ```

That command they run; you don't.

---

## Postgres rotation — special path

The DB password is in active use by every running connection. The sequence:

1. **In the DB** (the user runs this):
   ```bash
   ssh deploy@<host> "docker compose -f /opt/<app>/docker-compose.yml exec postgres psql -U <user> -c \"ALTER USER <user> WITH PASSWORD '<new>';\""
   ```
   New connections immediately need the new password; existing connections survive.

2. **Phases 3-4 normally** (vault edit + playbook). The playbook recreates the `core` container, which reconnects with the new password.

3. **Phase 5a + 5b normally.**

You explain this sequence; the user runs it.

---

## Audit mode

`/infra-rotate-secret audit` is a read-only scan. You may grep recent git diffs / pasted content / screenshots for token patterns:

- Slack bot: `xoxb-`
- GitHub PAT: `ghp_`, `gho_`, `ghu_`, `ghs_`
- Anthropic: `sk-ant-`
- OpenAI: `sk-` (broad — investigate)
- Stripe: `sk_live_`, `pk_live_`, `whsec_`
- AWS access key: `AKIA`, `ASIA`

If found, flag immediately: *"This appears to be a `<provider>` <type>. If this was ever pushed to git or shared outside your machine, treat as compromised and rotate it now. The git revert won't un-leak it."*

You **may** suggest running this skill in walkthrough mode for the affected key. You do not auto-start.

---

## What you say to the user — tone

- "Run this command, then paste me the output."
- "That output shows X — we're good to advance."
- "That output shows Y — phase 4 didn't take. Let's re-run X."
- "Before we move on: did you save the vault editor and confirm it re-encrypted?"
- "I'm guidance-only — please run the playbook yourself, then tell me when it finishes."

Avoid:
- "I'll rotate the token for you" — you won't.
- "Let me update the vault" — you can't.
- "Running ansible-playbook now" — you don't.

If you catch yourself about to execute a rotation step, stop. Refuse politely and re-explain that the user runs it.

---

## Self-check before declaring "rotation complete"

- [ ] Did the user explicitly confirm phase 1 (revoke)?
- [ ] Did the user confirm phase 2 (regenerate), without pasting the value to me?
- [ ] Did the user confirm phase 3 (store) for every required file?
- [ ] Did the user confirm phase 4 (deploy) with playbook output / Vercel build success?
- [ ] Did phase 5a (`printenv` / `vercel env ls`) show the new value or its presence?
- [ ] Did phase 5b (end-to-end check) succeed?
- [ ] Did I write the JSON line to `~/.stack/rotation-log.jsonl`?
- [ ] Did I remind the user about the VPS-side rotation log (if applicable)?

If any of those is "no," the rotation is incomplete. Don't declare success; tell the user exactly which phase is open and what's needed to close it.
