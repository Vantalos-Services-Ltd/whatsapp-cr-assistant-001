# Old vs New — what actually differs

Two versions sit on GitHub. This is what separates them, and how to look at both
before deciding whether to merge.

- **Old** = `main` — what was there before this work
- **New** = `ux-and-dedupe` — the branch just pushed

---

## See them for yourself

From the project folder:

```bash
./run compare old     # switches the running app to the OLD version
./run compare new     # switches back to the NEW version
```

Each takes about 20 seconds, then refresh http://localhost:3000/operator
(`admin@example.com` / `admin123`). Flip back and forth as often as you like —
nothing is lost either way, and the demo data stays the same so you are
comparing like with like.

**Best screen to compare:** Inbox → click **Kieran Doyle**. Every meaningful
difference is visible on that one screen.

---

## The short version

The old version **cannot be set up from scratch**. Three bugs stop the database
from ever being created, so a fresh clone fails before the app starts. It runs
on your Mac right now only because the environment was already fixed by hand.

Everything else is improvement rather than repair.

---

## 1. Things that were broken

| | Old (`main`) | New |
|---|---|---|
| Migration file order | 3 files dated 2025 instead of 2026, so they run **before** the tables exist | Renamed, correct order |
| `add_job_pipeline` migration | Saved as **UTF-16**; Prisma reports it as missing | Converted to UTF-8 |
| Duplicate migration | `add_message_review_samples` exists twice; the second crashes | Made a safe no-op |
| Database connections | **15 files** each open their own connection pool | All share one |
| `/api/tasks/all` | **No agency scoping** — queried across every agency | Scoped |

The first three mean `prisma migrate deploy` fails on a clean database. That is
the difference between "a colleague can clone this and run it" and "only Joe's
laptop works".

---

## 2. What you will see on screen

Open Inbox → Kieran Doyle in each version.

| | Old | New |
|---|---|---|
| Task description | `SEND_MESSAGE`, `REQUEST_INFO`, `DORMANT CANDIDATES MATCH URGENT JOB` | "Reply drafted — asking about a job", "Needs more info", "Dormant candidate matches urgent job" |
| Same text repeated | Title and subtitle show the identical sentence | Subtitle falls back to the task type |
| Sender with no name | `—` | The phone number, or "Unknown contact" |
| Why approval is needed | Blank on 9 of 11 tasks | Shown in plain English |
| AI's reasoning | Hidden behind an unlabelled chevron | Visible by default: rationale, facts used, uncertainty, alternatives |
| Risk badge | `MEDIUM` — fails contrast at 2.94:1 | `◐ MEDIUM RISK` — passes, and not colour-only |
| Approve button | Outline, same visual weight as Reject | Filled blue, clearly the primary action |
| Keyboard | None | **A** approves, **R** rejects |

Whole-console checks: colour contrast failures went **5 → 0**, and internal
codes leaking into the interface went from every row to **zero**.

---

## 3. On a phone

The old version is unusable at 375px: the sidebar takes a third of the screen
with no way to dismiss it, and the task list is squeezed to nothing — the
approve panel cannot be reached at all.

The new version has a proper slide-over menu, stacks the panels, and taps
through to a task detail view. Touch targets raised from 36px to 44px.

Worth flipping to `old`, narrowing your browser window, and seeing this one
directly.

---

## 4. Duplicates removed

- Two copies of an approval component (**748 lines**, drifted apart, both
  containing approve/reject logic) that nothing imported — deleted
- A duplicate `src/components/` folder invisible to the app — deleted
- Two API routes that duplicated others — removed
- The **Tasks** page silently hid card-verification tasks and showed blank
  names; it now matches the Inbox exactly (both return the same 11 rows)

---

## 5. New things that did not exist before

| File | What it does |
|---|---|
| `start-demo.sh` / `Vantalos Demo.command` | Start everything with one command or a double-click |
| `run` | Short commands: `./run seed`, `./run stop`, `./run status`, `./run compare` |
| `set-key.sh` | Store API keys without them appearing on screen or in shell history |
| `prisma/demo-seed.ts` | 8 candidates, 4 jobs, 36 messages, pipeline, earnings, review samples |
| `scripts/demo-message.ts` | Simulate an inbound WhatsApp message through the real AI pipeline |
| `src/services/whatsappSender.ts` | Demo mode — full pipeline with no risk of messaging a real person |
| `DEMO-GUIDE.md`, `SUPABASE-SETUP.md` | Plain-English setup and demo instructions |
| `tsconfig.api.json` | Lets the backend be type-checked at all |

---

## What is NOT fixed on either version

Being straight about this, because merging will not change it:

- **The test suite does not run.** All 23 test files have a broken import
  (`from '.ts'`). True on both versions. Nothing is verified automatically.
- **No CI.** Nothing checks a change before it merges.
- **Proactive WhatsApp outreach** will not work on a real number until message
  templates are added.
- **`schema.prisma` is missing columns** that the migrations create (`stuckAt`,
  `metadata`), so the stuck-task monitor detects but cannot record.

---

## Recommendation

Merge it. The old version cannot be set up from a clean clone, and every change
on the new branch is either a repair or an improvement — nothing was removed
except dead code.

But look first. Run `./run compare old`, open the Inbox, then `./run compare
new` and open the same screen. Two minutes, and you will have seen the whole
difference yourself.

If anything looks wrong, nothing is committed to `main` yet and the branch can
be changed or abandoned without consequence.
