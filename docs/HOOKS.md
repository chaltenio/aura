# Hooks: how the repo keeps everyone in sync without anyone remembering

Claude Code hooks (in `.claude/settings.json`, scripts in `scripts/hooks/`) run automatically in every
teammate's session. They enforce branch-first work, report what each person is doing to the team bus,
prompt for merge-back at the right moment, keep `origin` fresh, and nag about unpushed work. None of
them need a new account: the bus is the pinned GitHub issue (`scripts/bus.sh`).

| Hook | Fires | What the developer sees | Bypass |
|---|---|---|---|
| `pre-edit-guard.sh` (PreToolUse on Edit/Write/MultiEdit/NotebookEdit) | Before any file edit | On `main` or detached HEAD the edit is refused with: **"On main: run /start to claim a task and create your branch (name/task) before editing."** Claude then runs /start. TODO.md, docs/INTEGRATION_LOG.md and files outside the repo are always allowed. | `MERGE_SKILL=1` or `INTEGRATOR=1` in the environment (merge resolver, integrator loop) |
| `post-commit.sh` (PostToolUse on Bash) | After a command containing `git commit` | Posts **`[STATUS] ... COMMIT <branch>: <subject>`** to the bus in the background. When the branch is 3+ commits ahead of `origin/main` or 30+ minutes old (at most once per 20 min), Claude is told to ask you: **"merge back to main?"** Yes: `scripts/bus.sh ready` (the integrator merges it) or `/merge`. No: keep going. | Marker files in `.bus/merge-asked-*`; `HOOKS_DRY=1` prints instead of posting |
| `prompt-submit.sh` (UserPromptSubmit) | On every prompt you send | Once per 10 minutes per session, a real task prompt (15+ chars, not a `/command`) is posted as **`WORKING <branch>: <first 100 chars>`** so nobody duplicates it. Every 10 minutes it runs `git fetch` in the background; if `origin/main` moved ahead of your branch base, Claude is told: **"origin/main has N new commits; run scripts/sync.sh before editing."** | `HOOKS_DRY=1`; delete `.bus/working-<session>` to re-post |
| `stop-reminder.sh` (Stop) | When Claude finishes a turn | If your branch has uncommitted changes or unpushed commits: **"Uncommitted/unpushed work on <branch>: commit and run scripts/sync.sh before you leave."** Never blocks. | none needed |
| SessionStart (team-infra) | New session, resume, clear, compact | The last 12 bus messages and the TODO.md STATUS paragraph, plus the /start onboarding instruction. | |

## `scripts/sync.sh`: the one command to run often

Before starting a chunk, after every atomic commit, and at least every 15 minutes:

```
scripts/sync.sh            # fetch, rebase your branch onto origin/main (autostash), npm test, push -u origin HEAD
scripts/sync.sh --no-test  # docs-only change (SKIP_TEST=1 also works)
```

On a conflict it aborts the rebase cleanly and says `rebase conflict with origin/main in: <files>. Run /merge to resolve.`
On `main` it refuses unless `MERGE_SKILL=1` (only the merge resolver and the integrator land on main).

## Lifecycle of a task

`/start` (claim + branch + bus) -> small commits (`COMMIT` lines appear on the bus) -> `scripts/sync.sh` often
(the prompt hook reminds you when main moved) -> the commit hook asks "merge back?" -> `scripts/bus.sh ready`
-> the integrator merges and posts `MERGED` -> `/start` the next thing. The Stop hook catches anything left behind.

## Testing a hook by hand

Hooks read JSON on stdin. Dry-run any of them without touching the bus:

```
printf '{"cwd":"%s","tool_input":{"file_path":"%s/web/hunt.js"}}' "$PWD" "$PWD" | sh scripts/hooks/pre-edit-guard.sh; echo "exit=$?"
printf '{"cwd":"%s","tool_input":{"command":"git commit -m x"}}' "$PWD" | HOOKS_DRY=1 sh scripts/hooks/post-commit.sh
printf '{"cwd":"%s","session_id":"t","prompt":"build the narrator on the big screen"}' "$PWD" | HOOKS_DRY=1 sh scripts/hooks/prompt-submit.sh
printf '{"cwd":"%s"}' "$PWD" | sh scripts/hooks/stop-reminder.sh
python3 -m json.tool .claude/settings.json >/dev/null && echo settings ok
```

Exit 2 from a PreToolUse hook blocks the tool call and shows stderr to Claude; exit 0 with a JSON object on
stdout injects `additionalContext` (PostToolUse, UserPromptSubmit) or a `systemMessage` (Stop). Every script
finishes in well under a second; network work (`bus.sh`, `git fetch`) is always backgrounded.


## First-prompt steer (added 2026-10-31)

The UserPromptSubmit hook also fires once per session (marker `.bus/started-<session>`): on the first prompt it tells Claude to run `/start` immediately (greeting, fit interview, claim, branch) and prints the live app URL from `fly.toml` for phone testing. Skipped when `INTEGRATOR=1` or `MERGE_SKILL=1`. The SessionStart hook prints the same live URL and the deployed version at the top of every session.
