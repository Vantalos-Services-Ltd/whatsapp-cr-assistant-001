# Vantalos Recruiter — Demo Guide

Written for someone who doesn't work in the code. Everything you need is here.

---

## 1. Start it

Open the Terminal app, then copy and paste this one line:

```bash
cd ~/Code/vantalos-recruiter && ./start-demo.sh
```

It takes about 20 seconds. When it's ready your browser opens automatically.

**Login:** `admin@example.com` — **Password:** `admin123`

To stop everything afterwards:

```bash
cd ~/Code/vantalos-recruiter && pnpm stop
```

---

## 2. What you're looking at

This is an AI assistant for a construction recruitment agency. Candidates message
the agency on WhatsApp. The AI reads each message, works out what the person
wants, builds up a profile on them, tracks where they are in the hiring process,
and drafts a reply. Anything commercially sensitive — pay rates, job offers,
start dates — is held back for a human to approve before it sends.

The screens down the left-hand side:

| Screen | What it shows |
|---|---|
| **Dashboard** | Live counts, quality metrics, your commission tracker |
| **Inbox** | AI-drafted replies waiting for your approval |
| **Tasks** | Everything outstanding — follow-ups, document chases, outreach |
| **Messages** | The WhatsApp conversations themselves |
| **Candidates** | Searchable database, auto-built from the chats |
| **Jobs** | Live vacancies, candidate matches, and the placement pipeline |
| **Contacts** | Everyone the agency has spoken to |
| **Review** | Quality control — grading the AI's drafts |
| **Settings** | The "playbook" — tone of voice and safety rules |

---

## 3. A demo that lands (about 6 minutes)

**Start on the Dashboard.** Point out the live counts and the earnings tracker
showing progress toward the next commission bracket.

**Go to Inbox.** Four drafts are waiting. Open **Marek Kowalski's** — he asked
"What's the day rate on it?"

This is the single best thing to show. Note that:

- The AI drafted a reply that deliberately **does not quote a number**
- It's flagged **HIGH risk** and the conversation is **paused** — nothing was sent
- The **"Why this suggestion?"** panel explains its reasoning, which facts it
  used, what it's unsure about, and what alternatives it considered

That panel is the differentiator. Most AI tools are a black box; this one shows
its working, which is what makes it safe to let near a real candidate.

**Approve it** (edit the wording first if you like) and watch the conversation
resume.

**Go to Jobs → Salford Quays Commercial Fit-Out.** It's marked URGENT and is
five people short. Look at the candidate matches with their scores and reasons.
Then look at the Pipeline tab — candidates moving Shortlisted → Offer Sent →
Start Confirmed.

**Go back to Inbox** and open the outreach task for **Kieran Doyle**. The system
noticed by itself that an urgent job was short-staffed, found a plasterer who'd
gone quiet 47 days ago, and drafted a re-engagement message. Nobody asked it to.
That's the revenue engine.

**Finish on Review.** Show how every approved message can be sampled and graded,
so the AI's quality is measured rather than assumed.

---

## 4. Simulating a live message

You can send a message *as a candidate* and watch the system react — no WhatsApp
needed.

See who you can pretend to be:

```bash
cd ~/Code/vantalos-recruiter && pnpm demo:message --list
```

Then send something:

```bash
cd ~/Code/vantalos-recruiter && pnpm demo:message "Danny" "I'm free from Monday and I've got my CSCS card"
```

Refresh the console after a few seconds. To watch it think in real time, open a
second Terminal window and run `pnpm logs`.

> **This works best once you've added an OpenAI key** (section 6). Without one,
> the system still processes the message correctly but won't draft a reply —
> you'll see the pipeline run and then stop. With a key, you get the full effect.

---

## 5. Resetting between demos

Puts everything back exactly as it started:

```bash
cd ~/Code/vantalos-recruiter && pnpm demo:seed
```

Safe to run as often as you like.

---

## 6. Adding your OpenAI key (10 minutes, ~$5)

Strongly recommended — it's the difference between showing screens and showing
the product actually thinking.

1. Go to **platform.openai.com/api-keys** and sign in
2. Add about $5 of credit under Billing (a demo costs pennies)
3. Click **Create new secret key**, copy it
4. Open the settings file:
   ```bash
   open -e ~/Code/vantalos-recruiter/.env
   ```
5. Find the line `OPENAI_API_KEY=` and paste your key straight after the `=`,
   with no spaces. Save and close.
6. Restart: `cd ~/Code/vantalos-recruiter && ./start-demo.sh`

The startup message will now say **AI replies: ON**.

---

## 7. Connecting real WhatsApp (only when you need it)

Not required for the demo — the current setup is deliberately disconnected from
live messaging, which means **nothing can ever accidentally message a real
person.**

When you do want it live, there are two routes:

**Twilio Sandbox** — free, working in about 10 minutes. The catch is that
everyone who wants to chat must first text a join code (yours was
`join-birth-began`) to Twilio's shared number, and re-join after 72 hours of
silence. Fine for demos, not for real candidates.

**A production WhatsApp number** — a proper branded sender with no join code.
Requires registering with Meta through Twilio: business verification for
Vantalos, and display-name approval. Usually several days to a few weeks, mostly
waiting on Meta. This is what you'd need for real candidates.

Either way, fill in the three `TWILIO_` lines in `.env`, set `DEMO_MODE=false`,
and you'll also need a tunnel (ngrok) so Twilio can reach the app.

> **One limitation to know about.** WhatsApp only allows free-form messages
> within 24 hours of a person last messaging you. Outside that window you must
> use pre-approved message templates, which this app doesn't implement yet. So
> replies to incoming messages work perfectly, but the *proactive* outreach
> features (chasing dormant candidates) will be blocked by WhatsApp on any
> number until templates are added. Worth budgeting for.

---

## 8. If something goes wrong

**Nothing loads in the browser** — the app probably isn't running. Run
`./start-demo.sh` again; it cleans up after itself.

**"Port already in use"** — run `pnpm stop`, then start again.

**A screen is empty that shouldn't be** — run `pnpm demo:seed` to rebuild the
data.

**Something else** — the error is almost always at the bottom of:
```bash
tail -40 /tmp/vantalos-api.log
```
Send that to whoever's helping you.

**After restarting your Mac** — the database and Redis restart automatically.
Just run `./start-demo.sh`.

---

## 9. Where things live

```
~/Code/vantalos-recruiter/
├── start-demo.sh      ← the launcher
├── .env               ← your settings and keys (never share this file)
├── DEMO-GUIDE.md      ← this document
├── src/               ← backend: webhooks, AI services, background workers
├── app/ + components/ ← the operator console you see in the browser
└── prisma/            ← database structure and demo data
```

The code is also on GitHub at `Vantalos-Services-Ltd/vantalos-core-product`.

---

## 10. Known issues worth knowing before you demo

Honest list, so nothing surprises you:

- **The automated test suite doesn't run.** Every test file has a broken import.
  Nothing is verified automatically, so changes carry real risk until it's fixed.
- **The backend isn't type-checked.** A second config (`tsconfig.api.json`) has
  been added so it *can* be — run `pnpm typecheck:api` — but there are existing
  errors to work through.
- **Proactive WhatsApp outreach won't work on a real number** until message
  templates are added (see section 7).
- **Two copies of the same data contract exist** (`src/dto/operator.ts` and
  `shared/dto/operator.ts`) and have drifted apart. Both are live — the backend
  uses one, the frontend the other. Worth merging.
- **Some dead files remain** (`src/components/`, two unused `InlineApprovalCard`
  components) — harmless, but clutter.

None of these affect the demo. They matter when you start building on it again.
