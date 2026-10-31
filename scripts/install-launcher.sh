#!/bin/sh
# Installs a shell function so that plain `claude` (no args) inside a repo that has .claude/launch-prompt
# opens Claude Code with that prompt already submitted: the steering interview starts without typing.
# Idempotent. Adds to ~/.zshrc and ~/.bashrc if present. Remove the block between the markers to uninstall.
set -e
block='# >>> haunt claude launcher >>>
claude() {
  if [ $# -eq 0 ] && top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -f "$top/.claude/launch-prompt" ]; then
    command claude "$(cat "$top/.claude/launch-prompt")"
  else
    command claude "$@"
  fi
}
# <<< haunt claude launcher <<<'
for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  [ -f "$rc" ] || continue
  if grep -q '>>> haunt claude launcher >>>' "$rc"; then echo "already installed in $rc"; else printf '\n%s\n' "$block" >> "$rc"; echo "installed in $rc"; fi
done
echo "Open a new terminal (or run: source ~/.zshrc), cd into the repo, type: claude"
