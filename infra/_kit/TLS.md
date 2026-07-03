# TLS in Local Development — The Complete Guide

Why HTTPS on `localhost` is harder than it should be, and how the Nucleus Stack Kit solves it.

**One-line summary:** the kit uses [mkcert](https://github.com/FiloSottile/mkcert) to mint locally-trusted certs for `<project>.loc` hostnames, so `https://your-app.loc` (and every other dev URL) works in every browser, on every OS, with no "your connection is not private" warning.

---

## The 30-second version

```
# One time per machine (any project):
brew install mkcert nss        # macOS — see "Cross-platform install" below
mkcert -install                # creates a local CA + drops it in trust stores

# One time per project:
stack tls install              # generates infra/certs/<slug>.{pem,-key.pem}
                               # auto-wires Caddyfile + compose
                               # reloads caddy
```

That's it. After that, `https://<slug>.loc` works forever (cert auto-expires in 2+ years; `stack tls renew` regenerates).

---

## Glossary — read this once

| Term | What it actually means |
|---|---|
| **TLS** | The encryption protocol behind `https://` (formerly known as SSL). |
| **Certificate (cert)** | A file that says *"this hostname is who it claims to be."* Contains a public key + a signature by an authority. |
| **Certificate Authority (CA)** | An entity that signs certificates. Browsers ship with ~150 trusted CAs (Let's Encrypt, DigiCert, GlobalSign…). Only certs signed by a trusted CA get a green padlock. |
| **Root CA** | The top-level CA cert in a trust chain. Browsers trust roots; intermediate CAs (which sign your cert) chain back to a root. |
| **Trust store** | The OS / browser list of trusted root CAs. macOS Keychain, Linux's `ca-certificates`, Windows root store, Firefox's NSS DB are all trust stores. |
| **Self-signed cert** | A cert that signs itself — no CA. Browsers reject these by default (no trust chain to root). What Caddy's `tls internal` produces by default *for the leaf cert* — actually a misnomer because Caddy creates its own CA, but the CA isn't installed in your trust store. |
| **mkcert** | A tool that creates a *private CA on your machine* and registers it in your trust stores. Then it signs dev certs with that CA, and your browser trusts them because the signing CA is trusted. |
| **NSS DB** | Mozilla's separate trust database — Firefox and (on Linux) Chromium use it instead of the OS trust store. |

---

## Why this is annoying without a tool

Three half-solutions explain why we need a fourth.

### Half-solution 1 — `tls internal` (Caddy's default)

Caddy auto-generates a CA + signs `<host>` with it. Problem: **the CA isn't installed in your trust stores**, so every browser shows "your connection is not private." You can click through, but:

- Some browsers (recent Chrome/Brave with strict modes) just say "page couldn't load" with no override.
- Webhooks won't accept self-signed.
- HSTS / secure-cookies behave weirdly.
- HTTP/3 needs proper trust.

### Half-solution 2 — buy a real cert from Let's Encrypt

Doesn't work for `.loc` or `localhost` — Let's Encrypt only signs publicly-resolvable hostnames. You'd need a real DNS-resolvable subdomain pointing at your laptop, which is fragile and slow.

### Half-solution 3 — manually trust Caddy's local CA

`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain <caddy-root.crt>`. Works on macOS for Safari/Chrome, but Firefox needs a separate step (NSS DB), Linux needs separate work, Windows needs PowerShell, and you have to do it once per project (or extract Caddy's CA per stack). Doesn't scale.

### The real solution — mkcert

One tool, three platforms, every browser. Does the right thing in every trust store on the system. Maintained by [Filippo Valsorda](https://filippo.io) (formerly Cloudflare crypto, now Go's crypto maintainer). Trustworthy.

---

## Cross-platform install

### macOS

```bash
brew install mkcert nss
mkcert -install
```

`nss` is required for Firefox. Without it, Safari/Chrome work but Firefox shows the warning.

### Linux (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install libnss3-tools

# Then install mkcert binary. Either:
#   (a) From your distro: sudo apt install mkcert       (Debian 12+, Ubuntu 23.04+)
#   (b) Via brew/Linuxbrew: brew install mkcert
#   (c) Manual:
#       curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
#       chmod +x mkcert-v*-linux-amd64
#       sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert

mkcert -install
```

### Linux (Fedora / RHEL)

```bash
sudo dnf install nss-tools
# install mkcert binary (any method above)
mkcert -install
```

### Linux (Arch)

```bash
sudo pacman -S nss
yay -S mkcert  # or paru, or any AUR helper
mkcert -install
```

### Windows

```powershell
# Chocolatey:
choco install mkcert

# OR Scoop:
scoop bucket add extras
scoop install mkcert

# Then:
mkcert -install
```

mkcert on Windows reaches both Edge/Chrome and Firefox automatically.

### WSL

mkcert from inside WSL only touches the WSL Linux trust stores. To make Windows browsers trust the CA, run `mkcert -install` from a Windows shell **as well**. They share the certs via the filesystem if your project lives under `/mnt/c/`.

---

## What `mkcert -install` actually does

This is the *one privileged step* in the whole flow. Specifically it:

1. **Creates a local CA** at `$(mkcert -CAROOT)` (typically `~/Library/Application Support/mkcert/` on macOS, `~/.local/share/mkcert/` on Linux). The CA's private key never leaves your machine.
2. **Installs the CA public cert** into:
   - macOS: System keychain (Safari, Chrome, Edge) + Firefox's NSS DB (via `nss`)
   - Linux: `/etc/ca-certificates/extracted/...` (system) + each user's Firefox/Chromium NSS DB
   - Windows: Root store (Edge, Chrome) + Firefox
3. Prompts for sudo / Admin / Keychain auth once.

You only run this once per machine, ever. Across every project that uses mkcert.

To verify it took:

```bash
mkcert -CAROOT       # prints the CA dir
ls "$(mkcert -CAROOT)"  # rootCA.pem + rootCA-key.pem should exist

# macOS — confirm in System keychain
security find-certificate -c "mkcert" /Library/Keychains/System.keychain

# Linux — confirm in system trust dir
ls /usr/local/share/ca-certificates/ | grep -i mkcert
```

---

## What `stack tls install` does (per project)

This is the per-project step the kit owns. Each project runs it once. Idempotent — re-runs just regenerate.

For Demoapp:

```bash
stack tls install
```

Internally, this:

1. **Preflight:** confirms `mkcert` is on PATH and `mkcert -install` has been run. Fails with hints if either is missing.
2. **Reads `infra/_kit/manifest.yaml`** for `project.domain_dev` (e.g., `your-app.loc`).
3. **Creates `infra/certs/`** if missing.
4. **Runs:**
   ```bash
   mkcert -cert-file infra/certs/<slug>.pem \
          -key-file  infra/certs/<slug>-key.pem \
          <slug>.loc "*.<slug>.loc" localhost 127.0.0.1 ::1
   ```
5. **Verifies the Caddyfile** has a `tls <pem> <key>` line for `<slug>.loc`. If it still says `tls internal`, the kit either patches it (with confirmation) or tells you exactly what to change.
6. **Verifies the compose file** mounts `./certs:/etc/caddy/certs:ro` for the caddy service. Same.
7. **Verifies `.gitignore`** has `infra/certs/`. Same.
8. **Reloads caddy** so the new cert takes effect (`docker compose ... up -d --force-recreate caddy`).
9. **Smoke-tests** `https://<slug>.loc/` and reports the cert's expiry date.

After that, `https://<slug>.loc` works in every browser on the machine.

---

## What gets created

```
infra/
├── Caddyfile.dev           # tls <pem> <key>   (referenced from inside container)
├── docker-compose.dev.yml  # mounts ./certs:/etc/caddy/certs:ro
└── certs/                  # GITIGNORED — never commit
    ├── your-app.loc.pem       # the cert (public — but private = pair with key)
    └── your-app.loc-key.pem   # the private key — DO NOT SHARE
```

Inside the running caddy container, those files appear at `/etc/caddy/certs/your-app.loc.pem` and `your-app.loc-key.pem`.

---

## Cert expiry & renewal

mkcert certs are valid for **825 days** (a bit over 2 years). The expiry is printed when you generate them; the cert itself can be inspected anytime:

```bash
openssl x509 -in infra/certs/your-app.loc.pem -noout -dates
# notBefore=May 19 11:03:58 2026 GMT
# notAfter =Aug 19 11:03:58 2028 GMT
```

When you get within 30 days of expiry, run:

```bash
stack tls renew
```

…which is just `stack tls install` again — idempotent regeneration. Caddy reloads automatically; browsers re-validate on next request.

The kit's `stack doctor` flags certs that are within 60 days of expiry so you're never surprised.

---

## Verification

After `stack tls install`, four signals confirm health:

```bash
# 1. The cert is there and chains to mkcert's CA
openssl verify -CAfile "$(mkcert -CAROOT)/rootCA.pem" infra/certs/<slug>.pem
# expected:  infra/certs/<slug>.pem: OK

# 2. Caddy reports the cert as loaded
docker compose -f infra/docker-compose.dev.yml -p <slug>_<worktree> \
  logs caddy --tail 50 | grep -i "loaded"
# expected:  "skipping automatic certificate management because one or more matching certificates are already loaded"

# 3. curl WITHOUT -k succeeds (i.e., the system trust store accepts it)
curl -s -o /dev/null -w "HTTP %{http_code} · ssl_verify=%{ssl_verify_result}\n" https://<slug>.loc/api/health
# expected:  HTTP 200 · ssl_verify=0     (0 = success)

# 4. A browser opens https://<slug>.loc with a green padlock, no warning
open https://<slug>.loc
```

If any of those fail, see Troubleshooting.

---

## Troubleshooting

### Browser still shows "Not Secure" or "couldn't load"

Most common causes, in real-world frequency:

| Symptom | Likely cause | Fix |
|---|---|---|
| Worked yesterday, broken today | Browser HSTS / DNS cache | Quit and reopen the browser. In Chrome: `chrome://net-internals/#hsts` → "Delete domain security policies" → `<slug>.loc`. |
| Works in Safari, broken in Firefox | `nss` (or `libnss3-tools`) wasn't installed when `mkcert -install` ran | `brew install nss` (or apt equivalent), then `mkcert -install` again. |
| All browsers warn | `mkcert -install` never ran, or ran as a different user | `mkcert -install` as the user whose browsers you use. |
| Cert exists but caddy serves the wrong one | Compose mount missing, or Caddyfile still says `tls internal` | `grep -n "tls " infra/Caddyfile.dev` — should reference cert files. `docker compose -f infra/docker-compose.dev.yml -p <proj> exec caddy ls /etc/caddy/certs` — should list `<slug>.loc.pem`. |
| `curl: (60) SSL certificate problem` | Cert path wrong inside container, or caddy didn't reload | `docker compose ... restart caddy` + check logs for the "matching certificates already loaded" message. |
| "Operation not supported by device" on `mkcert -install` (macOS) | macOS rejected a Keychain prompt | Re-run; approve the prompt. |
| `mkcert: command not found` | Not on PATH | `brew install mkcert` / `which mkcert`. |

### Cert about to expire

```bash
stack tls renew      # regenerates, caddy reloads automatically
```

### Need to revoke a leaked cert

mkcert dev certs are local-trust only — if a private key leaks, the attacker can only impersonate `<slug>.loc` to *your* browsers. Still, rotate:

```bash
rm infra/certs/<slug>.{pem,-key.pem}
stack tls install
```

The new cert has a new key. The old cert is now untrusted unless someone copies it manually back in.

### Nuke everything

```bash
# 1. Remove per-project certs
rm -rf infra/certs/

# 2. Uninstall mkcert's local CA from your machine's trust stores (NOT just the kit's certs)
mkcert -uninstall

# 3. Optionally delete the CA itself (after uninstall)
rm -rf "$(mkcert -CAROOT)"
```

After step 2, all certs signed by mkcert across all projects become untrusted in your browsers. You can `mkcert -install` again whenever you want to re-trust.

---

## FAQ

**Q. Is mkcert's CA dangerous?**
Only your machine trusts it. Nobody else's machine does. If your machine is compromised, an attacker can sign certs for any hostname *that your browsers will accept*. But they could already see all your local traffic in that scenario, so it's not a meaningful escalation. The CA private key lives in `$(mkcert -CAROOT)` and never leaves your disk.

**Q. Why don't we use Let's Encrypt for dev?**
LE only signs publicly-resolvable hostnames. `<slug>.loc` is a `127.0.0.1`-resolver hostname — LE can't validate it. You'd need a real `dev.<slug>.example.com` pointing at your laptop, which is fragile (NAT, dynamic IPs) and slow (LE API roundtrip on every cert).

**Q. Why not just trust Caddy's `tls internal` CA?**
You could (`docker compose ... cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/ && sudo security add-trusted-cert ...`), but you'd have to do it per project, the CA gets regenerated when you `stack reset`, and Firefox/Chromium-on-Linux need separate steps. mkcert centralizes the trust install into one tool that handles all of it.

**Q. Multiple worktrees of the same project?**
They all use the same cert (one cert per hostname is fine — `your-app.loc` is `your-app.loc` regardless of which checkout serves it). Only one worktree can hold port 443 at a time anyway. The kit warns if you try to `stack up` a second worktree on the same project's caddy port.

**Q. What if I want `https://your-app.loc:8443` (non-standard port)?**
mkcert doesn't care about ports — the cert is bound to hostnames, not ports. Run caddy on whatever port, the cert still validates as long as the hostname matches. `/etc/hosts` still needs `127.0.0.1 your-app.loc`.

**Q. Does this work with self-hosted CI (GitHub Actions / GitLab / etc.)?**
No — those are remote machines without mkcert's CA. CI tests should hit `http://localhost:<port>` or use a real public cert. Local dev is the only place mkcert is appropriate.

**Q. Where does the kit document this for the AI?**
The agent (`.claude/agents/infra.md`) has a routing entry for "TLS / cert / https / mkcert" → `stack tls install`. The `/infra` skill shows `tls install` and `tls renew` in its menu. `stack tls --help` lists the subcommands.

---

## What "thoroughly" looks like — for the AI

When the AI executes `stack tls install`:

1. **Declare blast radius** before running anything:
   > *Generating mkcert-signed TLS cert for `<slug>.loc`. Writes infra/certs/<slug>.{pem,-key.pem}. Modifies infra/Caddyfile.dev (the `tls` line) and infra/docker-compose.dev.yml (caddy volume mount), idempotently. Adds infra/certs/ to .gitignore. Recreates the caddy container (~3s outage). Reversible: delete infra/certs/, revert the two file edits.*

2. **Run the steps** with verification after each one.

3. **End-of-run report**:
   - Cert paths
   - Cert expiry date
   - Caddy log line confirming the cert loaded
   - HTTP 200 from `https://<slug>.loc/api/health` without `-k`
   - Anything that needs the user's manual action (browser HSTS clear, Firefox restart, etc.)

4. **If anything fails**, report which step + the diagnostic command + the most likely fix from the Troubleshooting table.

---

## Reading list

- [mkcert README](https://github.com/FiloSottile/mkcert) — the canonical doc
- [Caddy TLS docs](https://caddyserver.com/docs/automatic-https) — what `tls internal` does vs. file-based
- [NSS in Chrome on Linux](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/cert_management.md) — why Linux trust is bifurcated
- [HSTS / cert troubleshooting](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/transport-security-state.md) — when your browser refuses despite a valid cert

If you've read this far: the kit's stance on TLS is *"trust the tool, not the workaround."* Install mkcert, run `stack tls install`, never think about it again.
