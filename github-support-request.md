# GitHub Support request — purge orphaned commits

Submit at: https://support.github.com/contact
Category: **Account or repository** → **Repository content / data removal**

---

**Subject:**

Request to garbage collect orphaned commits containing removed credentials — Vantalos-Services-Ltd/whatsapp-cr-assistant-001

---

**Message:**

Hello,

I need orphaned commits garbage collected from a repository I own, so that
credentials removed from its history are no longer retrievable by direct SHA.

**Repository:** https://github.com/Vantalos-Services-Ltd/whatsapp-cr-assistant-001

**What happened**

The file `.env.example` was committed with real credential values in it. The
current file uses placeholders, but the real values remained in earlier commits.

I have rewritten the repository history with `git filter-repo` to replace those
values, and force-pushed the rewritten history to all branches. Every branch is
now clean — the credentials do not appear in `main`, in any other branch, or in
any commit reachable by browsing or cloning the repository.

However, the original commits are still retrievable by their SHA. For example,
this URL still returns the original file contents:

https://raw.githubusercontent.com/Vantalos-Services-Ltd/whatsapp-cr-assistant-001/15c1dee0e04bf6b2ce5a2e2ec4d8f788f99ba070/.env.example

**What I am asking for**

Please run garbage collection on this repository to permanently remove the
orphaned commits and their associated blobs.

**The affected commits (all now orphaned):**

```
09ebdcdedc3de66d4e43a1d48da5c41e0f0fd107
e248367c8ffa69bf7cb2cb985bb67aa69a9d6c72
6b4711756f796f3c200e75dbcf090dc52913e7d4
15c1dee0e04bf6b2ce5a2e2ec4d8f788f99ba070
```

Each of these contains `.env.example` with values for `OPENAI_API_KEY`,
`TWILIO_AUTH_TOKEN` and `TWILIO_ACCOUNT_SID`.

**Current state after the rewrite:**

- `main` is at `78e4ef14`
- `ux-and-dedupe` is at `e5957e53`
- There are no forks, and no open pull requests referencing the old commits.

The exposed credentials have already been rotated, so this is not urgent — but I
would like the old objects removed so they are not retrievable and so secret
scanning no longer flags the repository.

Please confirm once garbage collection has run.

Thank you,
Joe Bradley
Vantalos Services Ltd

---

## After they confirm

Re-run this to verify — all four should return **404**:

```bash
for sha in 09ebdcdedc3de66d4e43a1d48da5c41e0f0fd107 \
           e248367c8ffa69bf7cb2cb985bb67aa69a9d6c72 \
           6b4711756f796f3c200e75dbcf090dc52913e7d4 \
           15c1dee0e04bf6b2ce5a2e2ec4d8f788f99ba070; do
  curl -s -o /dev/null -w "$sha -> %{http_code}\n" \
    "https://raw.githubusercontent.com/Vantalos-Services-Ltd/whatsapp-cr-assistant-001/$sha/.env.example"
done
```
