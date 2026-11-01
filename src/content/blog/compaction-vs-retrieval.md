---
title: "Compaction is not a mistake (but rewriting memory might be)"
description: "360 eval runs on real 500K-token agent sessions: what an agent should keep when its context fills up."
date: "Nov 01 2026"
---

Last week two ideas about long-running agents went around at the same time. Alexander Yue of Mainplane posted that ["compaction is a mistake"](https://x.com/alezander9/status/2115842998844178453): don't summarize when the context fills up, just start a fresh session that says "retrieve key context as you go". Cursor wrote about [dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery): keep history as files and let the agent search them. A few days later Harrison Chase wrote that the hard part of agent memory is [deciding what to remember](https://x.com/hwchase17/status/2116553654857867330), not the data structure.

I work on [Hermes Agent](https://github.com/NousResearch/hermes-agent), which does summarize when the context fills up. So instead of arguing about it on the timeline, I ran the experiment: 360 eval runs over 8 of my own real agent sessions, each cut at 500K tokens, on two model families (DeepSeek V4.1 Flash and Claude Haiku 5.5).

Short version: keep the summary. Use retrieval for facts, not for deciding what to do next. And stop rewriting your memory every time you compact.

Everything is public:

- The [full report](https://artifacts.kshitij.md/compaction-vs-retrieval/) has every table and per-session number.
- The [run explorer](https://artifacts.kshitij.md/compaction-vs-retrieval/runs/) has all 360 runs. Click any score to see each question, the gold answer, what the model said, how the judge scored it, every search it ran, and the summary it was given. "Compare across setups" puts one question next to every setup's answer.

## What I'd change

1. Keep a summary in context. On every test where the agent had to keep working, the summary beat search-as-you-go by 10 to 24 points, and it's the only thing that carried the "what did I forget" stuff: standing rules, dead ends, decisions.
2. Make the lookup path actually work for facts, and make tool output searchable. That one change is worth about +11 points of fact recall.
3. Nudge the agent to look things up before *stating* a specific fact, not before *acting*. Telling it to dig through history before acting cost 10 to 24 points.
4. When you compact repeatedly, don't feed the old summary back in to be rewritten. Carry facts forward in an append-only ledger.
5. Don't bother tuning the summary prompt. Extra headings made summaries shorter and worse.

## What I found

### Dropping the summary keeps facts and loses the plot

I gave the agent two exams after compaction. The needle exam asks 15 specific questions about the compacted part ("what error did the migration hit?"), so the question tells the agent what to search for. The orientation exam asks open questions like "list the user's standing rules" or "list the approaches that already failed". Nothing tells the agent what to search for there.

| Setup | Fact recall | Orientation | Context |
|---|---|---|---|
| Full 500K transcript | 96.7 | 47.5 | 497K |
| Summary + multi-step search | 93.8 | 48.9 | 68K |
| No summary + multi-step search (Mainplane style) | 89.6 | 15.9 | 60K |

Without a summary the agent still finds facts when you ask about them. But orientation falls from 49% to 16%, and the summary wins on 7 of 8 sessions. Haiku shows the same 34-point drop. Searching works when you know what you're looking for. You can't search for a rule you don't remember exists.

Dead ends are the worst-remembered thing everywhere. Even the best setup lists only about 40% of the approaches that already failed, and without a summary it drops to about 11%. That's how an agent ends up retrying something it already ruled out an hour ago. [Compare the "list every dead end" answers](https://artifacts.kshitij.md/compaction-vs-retrieval/runs/#cell=deepseek%2FS1%2Fnone__agentic4&q=orient-1).

### For continuing work, searching makes it worse

Q&A exams flatter retrieval, because the question hands the agent its search query. So I added a harder test. For each session I replayed the next 10 real user messages after the cut. The agent said what it would do next, and a judge compared that with what the original agent (with full context) actually did.

| Setup | DeepSeek | Haiku |
|---|---|---|
| Summary, no tools | **64.4** | **66.9** |
| Summary + search tools, neutral prompt | 54.4 | 42.5 |
| Summary + search, "look things up" prompt | 48.8 | 48.1 |
| No summary + search (Mainplane style) | 48.1 | 50.6 |

This surprised me. Giving the agent search tools made it worse at picking the next step, even when the prompt didn't push it to search. When it did search, it went back over old work ("let me verify this first", "this looks already done") instead of doing the obvious next thing. In one probe a background review finishes. The original agent immediately switches to its manual review fallback. The summary-only agent proposes the same thing. The searching agent spends five searches on old delegation IDs and runs out of steps. [Here's that probe across every setup](https://artifacts.kshitij.md/compaction-vs-retrieval/runs/#cell=deepseek%2FS3%2Flean__closed__cont&q=cont-6).

I can't fully rule out that it only searches when it's already confused. But in no setup did lookups help it continue the work.

### Make tool output searchable

When the agent is asked a fact, the summary plus a multi-step search gets within 3 points of the full transcript at about a seventh of the tokens. Most of that comes from one change: letting search see tool output. The error text, command output and file contents all live in tool results.

| Search over | Fact recall |
|---|---|
| User + assistant messages only | 81.2 |
| All messages including tool output | 92.5 |

A typical case: "Which PR number appears in the top merge commit of the git log?" The answer, `#13064`, only ever existed in a terminal output. The summary-only agent guessed. The agent that could only search chat messages came back empty. The one that could search tool output found it with a single query. [See all 25 setups answer it](https://artifacts.kshitij.md/compaction-vs-retrieval/runs/#cell=deepseek%2FS1%2Flean__closed&q=needle-2).

That's +11.2 on DeepSeek (better on 7 of 8 sessions) and +9.6 on Haiku. Grep on top of keyword search added nothing (+1.3, noise), so Cursor's "history file + grep" and a plain full-text index end up in the same place.

### Our own recovery path never worked

While building this I found that Hermes' post-compaction hint was broken. The summary told the model to call `session_search(query, session_id)`. That call shape ignored the query and returned the summary that was already in context. The default search also hid tool output. So in production the agent effectively had "summary, no lookup": 74.6% fact recall, against 93.8% for a working lookup. It had been like that since the feature landed. A fix is already open upstream ([#147077](https://github.com/NousResearch/hermes-agent/pull/147077)).

### Rewriting memory loses it

This is where Harrison's point comes in. Hermes' summarizer only reads up to 160K characters of input. A one-shot compaction of a 400K-token region is therefore summarizing about a 10% sample. In real use on 200K-context models, Hermes compacts every ~100K tokens and rewrites the previous summary each time. I tested that, and an append-only alternative:

| Memory | Fact recall | Orientation | With search | Continuation |
|---|---|---|---|---|
| One-shot summary at 500K | 74.6 | 51.1 | 92.5 | 64.4 |
| Rolling summary, rewritten every 100K | 63.4 | 41.3 | 87.1 | 69.4 |
| Append-only notes every 100K | 69.2 | 47.3 | 95.4 | 66.2 |

Rewriting the summary over and over loses about 11 points of fact recall and 10 of orientation. Each pass drops a bit more of the old stuff, like a game of telephone. It does keep the current state a little sharper (+5 on continuation). A plain append-only ledger of constraints, decisions, dead ends and artifacts, written as the session goes and never rewritten, beats the rolling summary by 6 to 8 points. That matches Harrison's point: the simple data structure won, and the hard part was what gets thrown away.

My guess at the right design is both: a rolling "where are we now" section, plus a fact ledger that is only ever appended to. I haven't tested that yet.

### Prompt tweaks barely matter

- Asking the summarizer for "Dead Ends" and "Artifact Ledger" sections made summaries shorter (12.2K to 8.4K tokens) and slightly worse. The model spreads a fixed budget thinner across more headings.
- Raising the summary's log budget from 4K to 12K tokens did nothing. The summaries came out the same length.
- Rewording the recovery instruction was worth at most 3 points.
- A "the summary is lossy, verify specifics before stating them" rule helped Haiku (+3.7) and did nothing for DeepSeek. Haiku trusts the summary too much: it searched only 38 of 120 fact questions with a summary in context, against 91 without.

## How the tests work

### The sessions

Eight of my own Hermes sessions, all long agent-development work: PR reviews and salvages, a provider integration review, a desktop and bot-mode review, a macOS TUI fix, issue clustering, skill planning. Each one is a full lineage, so a session that compacted and continued is stitched back together. Each is cut at the first ~500K tokens. They range from 1,100 to 6,200 messages and 2 to 4.7M tokens in total, so there's always real work after the cut to test continuation against.

| Session | Work | Messages compacted away | Context after compaction |
|---|---|---|---|
| S1 | macOS TUI fix | 600 | 87K |
| S2 | P1 issue clustering + salvage | 868 | 50K |
| S3 | long review campaign | 388 | 136K |
| S4 | provider PR review | 321 | 65K |
| S5 | skill planning | 299 | 63K |
| S6 | dev session | 527 | 39K |
| S7 | dev session | 713 | 45K |
| S8 | desktop / bot-mode PR review | 394 | 56K |

### What the agent keeps

- uncompacted: the full transcript. This is the ceiling.
- lean: what Hermes ships. One LLM summary, an index of exact identifiers (PR numbers, SHAs, paths), the user's messages verbatim, a footer pointing at search, and the last ~25K tokens of turns.
- anchors: lean without the LLM summary. Costs nothing to build.
- none: Mainplane's approach. "You are continuing this session, retrieve key context as you go", plus the same recent turns. Real Mainplane keeps no recent turns at all, so this is the generous version.
- rolling and notes: the two memory designs from the last section.

### How the agent can look things up

- closed: no lookup.
- one: one keyword search (SQLite FTS5 / BM25) that the model writes itself.
- agentic: up to 4 or 6 tool calls of `search`, `grep` and `read` over the archived history, with real function schemas.
- Variants switch tool output on or off, swap grep for search, or change the prompt from "look things up instead of guessing" to neutral.

### The three exams

1. Needle: 15 questions per session with literal gold answers, written from the compacted part. Graded 2 (right), 1 (partial) or 0 (wrong).
2. Orientation: 4 open questions per session. List the user's standing rules, the dead ends, the key decisions, the key artifacts and their status. Each has a gold checklist of up to 8 items, and the score is how much of it the answer covers.
3. Continuation: the next 10 real user messages after the cut. The agent says exactly what it does next, and the judge compares that with what the original agent did, 2/1/0.

The questions and checklists are generated once per session before any run starts, so every setup takes the same exam. Each compaction is computed once and shared by every setup that uses it, so a lucky or unlucky summary can't explain a difference. Round 1 used DeepSeek V4.1 Flash for everything. Later rounds repeat the key setups with Claude Haiku 5.5 writing the summary and answering, keeping DeepSeek as the judge and the same exams.

### The five rounds

| Round | What it tested | Runs |
|---|---|---|
| 1 | Every context × lookup combination, then grep vs search | 104 |
| 2 | Extra summary sections, footer wording, the Haiku repeat | 88 |
| 3 | The continuation exam, a "verify against the archive" rule, a bigger summary budget | 88 |
| 4 | Rolling summary vs append-only notes | 32 |
| 5 | Neutral-prompt continuation, memory designs on continuation, notes on Haiku | 48 |

One Hermes summary costs one LLM call: about 48K tokens in, 12K out, roughly 90 seconds on a flash model. Round 1 alone was about 236M prompt tokens of evaluation, mostly from the full-transcript ceiling, which re-reads 500K tokens for every question.

## Browse the runs

The [run explorer](https://artifacts.kshitij.md/compaction-vs-retrieval/runs/) is a grid of every setup against every session. Pick a model, a round and an exam, then click a score to open that run. Each run shows:

- every question with its gold answer and the model's answer, scored;
- the list of searches the agent ran (the query and how much it got back);
- the "Context" tab, which is the exact summary that setup was given;
- "Compare across setups", which lines up every setup's answer to the same question.

Text is shown as the models wrote it. Home paths, hostnames, emails, session IDs and anything shaped like a key are redacted. The raw transcripts and the 25K-token recent tail aren't published.

## Caveats

- Eight sessions, all agent development work from one person.
- The orientation exam is noisy. Even the full transcript only scores 47.5, so I'd ignore differences under ~10 points there.
- The continuation test compares against one sample of what the agent did, so 100% isn't reachable. Compare setups, not absolute scores.
- The search tools in the harness are simulated (BM25 and regex over the archived history), not Hermes' production tool.
- I didn't benchmark cost or latency, so I can't say anything about the dollar figures in the original tweet.

## How it was run

The harness extends Hermes' `evals/compaction` runner and uses the real `ContextCompressor`. Every compaction is computed once per session and shared across setups, so differences come from the setup and not from summary variance. Question banks are generated before any run starts. When comparing models, the judge stays on DeepSeek. Runs fanned out over a 20-core Linux box and my Mac, behind a cross-process concurrency limiter.

Things that bit me along the way:

- Reasoning models return empty strings if you cap `max_tokens` low, because the reasoning eats the budget.
- Tools described only in prompt text produced empty answers for 17 of 133 questions, and scored them as wrong. Passing real function schemas fixed it.
- An agent that hits its step limit will sometimes answer with a literal placeholder like `<answer action with the JSON tool>`.

Before trusting any score, check every answer for empties and placeholders.

The numbers, per-session tables and harness details are all in the [full report](https://artifacts.kshitij.md/compaction-vs-retrieval/).
