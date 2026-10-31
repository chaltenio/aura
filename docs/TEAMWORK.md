# TEAMWORK.md: building fast together without drifting apart

The failure mode at hackathons is not bad code, it is five people (and their agents) each building a different app in the same repo and discovering it at demo time. Everything below is aimed at one outcome: **main is always runnable, and everyone can say what is on it.**

## 1. Branching: trunk only, tiny commits

For a 4-hour build with 3 to 5 people plus agents: **commit straight to `main`**. No PR ceremony, no feature branches, no squash-merging.

- Small-team guides converge on trunk-based development with tiny changes merged many times a day; long-lived branches are where merge conflicts and integration surprises come from ([dev.to: git workflow for small teams](https://dev.to/moose978/a-git-workflow-for-small-teams-1f7n), [Harness: trunk vs feature](https://harness.io/blog/trunk-based-vs-feature-based-development)). The same guides warn that trunk-based only works with small atomic changes and a fast check before pushing, which is why `scripts/sync.sh` runs the test.
- A branch is allowed for exactly one thing: a spike you might throw away (a new engine, a risky library). It lives under an hour and lands as a rebase onto main, never a merge commit.
- Shelled runs are the exception that proves the rule: they produce PRs because the sponsor track requires PRs. Review them in under five minutes, rebase-merge, move on.
- Commit messages are the team chat log: `area: what changed`. Read `git log --oneline -20` instead of asking "what did you do".

## 2. Dividing work so the parts fit

- **Contract first.** ARCHITECTURE.md holds every route, payload shape, and WebSocket event name. Code that changes a shape changes the doc in the same commit. If the doc and the code disagree, the doc wins until someone fixes the code.
- **One owner per file.** The TODO.md Owner column is the lock. Touching someone else's file means telling them first and keeping the diff tiny.
- **Seams, not layers.** Split by page and endpoint (`register`, `hunt`, `screen`, the narrator agent), not by "frontend" and "backend". Each person owns a vertical slice end to end, so nobody is waiting for anybody.
- **Fixtures over mocks.** Shared sample data (`data/fixtures`, test photos) lets two people build both ends of a contract without the other end existing yet.
- **Integration checkpoint every 30 minutes.** Everyone runs `scripts/sync.sh`. The integrator runs the test on main, updates STATUS in TODO.md, and says out loud what is green, what is red, and who is on what.
- **One integrator.** A named person (or the integrator tab) is the only one who edits STATUS. Everyone else edits their own row.

## 3. Local parallelism: one worktree per task

Claude Code has native worktree support (v2.1.49, Feb 2026): each agent session gets its own directory sharing one `.git`, so sessions cannot overwrite each other's files or builds ([dev.to: worktrees + Claude Code](https://dev.to/stacknotice/git-worktrees-claude-code-run-parallel-ai-agents-on-the-same-repo-2026-mga), [codewithmukesh](https://codewithmukesh.com/blog/git-worktrees-claude-code/)).

- Use `EnterWorktree` (or `git worktree add ../haunt-<task> main`) per task. Install deps in each worktree (`npm install`), it is a separate directory.
- Git refuses to check out the same branch in two worktrees. That is a feature: each worktree makes short-lived commits and lands them on main through `scripts/sync.sh`, then the worktree is deleted.
- Subagents do not get worktrees by default. Two subagents told to edit the same file will clobber each other; give each a disjoint file list.
- **Clash** (https://github.com/clash-sh/clash, Rust CLI) watches local worktrees and warns about overlapping edits across parallel agents before they become conflicts. Optional; only worth it if more than three agents run at once.
- Keep a `CLAUDE.md` at the repo root (done). It is what keeps commit style and ownership rules consistent across every agent session.

## 4. The always-running integrator

What the user asked for: a tab that watches GitHub activity and actively keeps the parts fitting together. Three options, fastest first.

### Option A (use today): the `/integrator` skill in its own Claude Code tab
`.claude/skills/integrator/SKILL.md` is a loop body. Start it with `/loop 5m /integrator` from a dedicated worktree. Every pass it fetches origin, reads every new commit's diff against ARCHITECTURE.md and TODO.md ownership, runs `npm test`, flags file collisions and contract drift, updates STATUS, appends to `docs/INTEGRATION_LOG.md`, and tells the room in three lines what to do. It escalates instead of fixing, so it never races the humans. Zero setup beyond `gh auth`. Switch to `/loop 2m` in the last hour.

### Option B (20 minutes, if someone is repo admin): Claude on GitHub itself
Run `/install-github-app` inside Claude Code; it installs the Claude GitHub App and adds the `ANTHROPIC_API_KEY` secret (you must be a repo admin) ([claude-code-action README](https://github.com/anthropics/claude-code-action)). Two workflows are useful:
- `@claude` on any PR or issue comment (`issue_comment` / `pull_request_review_comment` triggers, `anthropics/claude-code-action@v1`): "@claude does this PR match ARCHITECTURE.md?" from the phone, in the room.
- Automatic review on every PR: trigger on `pull_request` with `types: [opened, synchronize]` and a `prompt` such as "Review against ARCHITECTURE.md; list contract drift and files owned by someone else per TODO.md". `claude_args: "--max-turns 10"` keeps it cheap ([claude-code-action usage docs](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)).
This only sees PRs, so it covers Shelled's PRs well and direct-to-main commits not at all. Pair it with Option A.

### Option C (skip for today): an autonomous repo custodian
There is no off-the-shelf OSS agent that watches pushes, runs a merge queue, and reconciles teammates' work. The nearest things are a 2026 GitLab "repo custodian" hackathon entry (reviews MRs, files issues, drafts fixes), a GitLab `mr-watch` proposal that detects branch-vs-main conflicts and escalates to a human, and Clash for local worktrees. The `mr-watch` discussion names the real hazard: changes that auto-merge cleanly but silently drop someone's code. That is why the integrator skill reads diffs for disappeared functions instead of trusting a green merge.

### What the integrator must never do
Merge or rewrite other people's commits, reassign tasks, or "fix" product code. It reads, tests, flags, and names the person who should act. The moment it starts editing `web/` or `server/`, it becomes a sixth developer nobody is coordinating with.

## 5. Communication

- **One pinned STATUS** (TODO.md, top). Dated, one paragraph, only the integrator edits it. Anyone who wants to know where we are reads that, not Slack.
- **The commit log is the chat log.** If it is not in a commit message or TODO.md, it did not happen.
- **Say it out loud, in this shape:** "I'm on `hunt.js` until 2:15, don't touch it." "Main is red, Sam's `server/index.js`, pull but don't push." "Shelled PR 2 is up, needs a five-minute review." Short, named, with a file or a time.
- **Every 30 minutes, the integrator says:** what landed, what is red, what each person does next. Three lines.
- **Demo owner.** One person owns the demo script and the deployed URL from hour two onward. Nothing merges in the last 30 minutes that is not on that script.

## 6. The daily (hourly) rhythm for today

| Minute | Everyone | Integrator |
|---|---|---|
| :00 | Claim rows in TODO.md, say what you are on | Start `/loop 5m /integrator` |
| :00 to :25 | Build in your own worktree, commit each working step | Watch pushes, run test, flag collisions |
| :30 | `scripts/sync.sh`, read STATUS | Update STATUS, log, speak |
| :30 to :55 | Build | Same |
| :55 | Sync again, real-phone check of main | Confirm main is demoable; name the one red thing |

## 7. Sessions on different laptops: the team bus

Claude Code's own messaging does not cross machines or accounts: `SendMessage`/`ListAgents` reach sessions on your machine, agent teams are "one team per session, scoped to that session", and Remote Control mirrors your own session to your own phone or browser ([agent teams docs](https://code.claude.com/docs/en/agent-teams), [Remote Control docs](https://code.claude.com/docs/en/remote-control)). The Claude GitHub App (`/install-github-app`) only reacts on PRs and issues and needs a repo admin; Claude in Slack needs a workspace and accounts people may not have.

So the bus is the thing everyone already has: **a pinned GitHub issue, read and written with `gh`.**

- `scripts/bus.sh` wraps it: `read`, `since`, `post`, `claim`, `ask`, `answer`, `decide`, `digest`. One comment per message, first line `[KIND] @who HH:MM sha`.
- `.claude/settings.json` (committed) has a SessionStart hook that prints the last 12 bus messages and the STATUS paragraph into every teammate's Claude context on startup, resume, clear, and compact. Nobody has to remember to read it.
- The `/integrator` loop reads `scripts/bus.sh since` every pass, answers ASKs it can answer from the docs, flags double claims, copies DECIDEs into TODO.md, and posts its digest back to the bus.
- Humans post from their phone by commenting on the issue. Subagents inherit the repo and `gh` auth, so they can post too; tell them to in the brief.
- Join in under five minutes, no new accounts: be a collaborator on the repo, have `gh auth login` done, clone, `npm install`, open `claude`. The hook does the rest.

Ruled out for today: a repo-hosted MCP server (`claude mcp add` per person plus an auth story, and it would just wrap the same `gh` calls), GitHub Discussions (disabled on the repo), Slack or Discord webhooks (accounts, and one more place to look). If the hackathon runs past today, the MCP server is the upgrade: same `bus.sh` verbs as tools, so agents call `claim_task` instead of shelling out.

## 8. Why we switched from direct-to-main to branches (13:40)

Direct-to-main works when two people touch different files. Within the first hour we had three Claude Code sessions on one laptop editing `web/face.js`, `server/index.js`, and the docs at once, plus a fork committing beside them. Edits landed on top of each other's uncommitted work and rebases were impossible with a dirty tree.

The rule now: every session on its own branch `<name>/<task>`, pushed after every commit, landed through `/merge`. `main` only ever moves by fast-forward from a rebased branch, so it is always one person's tested state. The merge resolver (`.claude/skills/merge/SKILL.md`) does the rebase and reads both sides of every conflict instead of picking one; the semantic-conflict checklist there is the part humans skip under time pressure. The integrator lists branches away from main and nudges anyone past 45 minutes.

Cost: one more step before your work is visible on main. Benefit: nobody's working tree is touched by anyone else, ever.

## 9. The steering-agent model

One Claude per person, all steered by the same three things: CLAUDE.md (rules), the bus (what everyone is doing right now), and ARCHITECTURE.md (the contract). Three skills mark the lifecycle of a piece of work: `/start` at the beginning (the SessionStart hook makes every fresh session open with it: state of the room, one question, claim, branch), `/integrator` in the middle (one tab watching main, branches and the bus, nudging), `/merge` at the end (rebase, resolve keeping both intents, fast-forward main). Nobody has to remember the process; their Claude runs it. The person's job is to pick what to build and to say when it works.

## 10. Lifecycle of a task

1. `/start` (automatic in a fresh session): state of the room, one question, pick from IDEAS.md section 3 or TODO.md.
2. Claim: `scripts/bus.sh claim`, your name in TODO.md Now, branch `<name>/<task>`, or continue your existing branch.
3. Build in small steps, one commit per working step. Hooks post `[COMMIT]` and `[WORKING]` to the bus for you.
4. `scripts/sync.sh` after every commit and at least every 15 minutes: rebases onto `origin/main`, runs the test, pushes your branch.
5. After about 3 commits or 30 minutes the commit hook asks: merge back? Say yes when the step is demoable.
6. `scripts/bus.sh ready "<branch>: what it does"`. The integrator merges it within a pass, or run `/merge` yourself.
7. Integrator: rebase, resolve keeping both intents, checks, fast-forward `main`, `[MERGED]`, branch deleted.
8. A conflict it cannot settle: `[ASK] @you` on the bus naming the files; answer and it retries next pass.
9. Tick the TODO row; say what you want next and your Claude claims and branches again.
10. Leaving the keyboard: commit and `scripts/sync.sh`. The Stop hook reminds you if anything is unpushed.

## 11. Automatic gist reporting and the board

Nobody has to narrate. Two hooks post for you: every `git commit` becomes `[COMMIT] <branch>: <subject> (<sha>)` and the first prompt of every ten minutes becomes `[WORKING] <branch>: <first 100 chars>`. `scripts/bus.sh board` prints the last 30 messages grouped by person, so "what is everyone doing" is one command. `[READY]` lines are picked up by the integrator and turn into `[MERGED]` or `[ASK]`. The board is the pinned GitHub issue; if anyone wants a web board with live updates, a Cloudflare Worker mirroring the issue is the upgrade path, not today.

