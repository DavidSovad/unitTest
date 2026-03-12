# CLAUDE.md

This file provides guidance to AI assistants (Claude Code and others) working in this repository.

## Repository Overview

**Repository:** DavidSovad/unitTest
**Status:** New project — no source code has been committed yet.

This file will be updated as the codebase evolves. The sections below establish conventions and workflows to follow from the start.

---

## Project Structure

> To be updated once source files are added. A typical layout to follow:

```
unitTest/
├── CLAUDE.md          # This file
├── README.md          # Project overview for humans
├── src/               # Application source code
├── tests/             # Unit and integration tests
├── docs/              # Documentation
└── .github/           # GitHub Actions workflows (if used)
```

---

## Development Workflow

### Branch Strategy

- Development branches must follow the pattern: `claude/<description>-<session-id>`
- Never push directly to `main` or `master` without explicit permission
- Always use `git push -u origin <branch-name>` when pushing

### Commits

- Write clear, descriptive commit messages that explain *why*, not just *what*
- Keep commits focused — one logical change per commit
- Do not amend published commits; create new commits instead
- Never skip commit hooks (`--no-verify`)

### Pull Requests

- PR titles should be under 70 characters
- Include a summary and test plan in the PR body
- Link to any related issues

---

## Testing

> To be defined once a testing framework is chosen. Common patterns:

- **Unit tests:** Test individual functions/modules in isolation
- **Integration tests:** Test interactions between components
- Run the full test suite before pushing
- All tests must pass before merging

```bash
# Example commands (update when framework is decided):
# npm test          # Node.js / Jest
# pytest            # Python
# go test ./...     # Go
# cargo test        # Rust
```

---

## Code Conventions

### General

- Prefer readability over cleverness
- Keep functions small and focused (single responsibility)
- Avoid over-engineering — write the minimum needed for the current task
- Do not add error handling for scenarios that cannot happen
- Do not add comments unless the logic is non-obvious

### Security

- Never commit secrets, credentials, `.env` files, or API keys
- Validate all input at system boundaries (user input, external APIs)
- Avoid common vulnerabilities: command injection, XSS, SQL injection (OWASP Top 10)

### Dependencies

- Review new dependencies carefully before adding them
- Prefer well-maintained packages with active communities
- Keep dependencies up to date

---

## AI Assistant Guidelines

### What to do

- Read files before modifying them
- Understand existing code before suggesting changes
- Make only changes that are directly requested or clearly necessary
- Use dedicated tools (Read, Edit, Grep, Glob) rather than raw shell commands where available
- Break multi-step tasks into a tracked todo list
- Confirm before taking irreversible or wide-blast-radius actions

### What to avoid

- Do not add features, refactor, or "improve" code beyond what was asked
- Do not add docstrings, comments, or type annotations to code you didn't change
- Do not create helper utilities for one-time operations
- Do not design for hypothetical future requirements
- Do not push to branches other than the one designated for the session
- Do not force-push to `main`/`master`
- Do not commit `.env`, credential files, or secrets

### Git safety

- Prefer creating new commits over amending
- Use `git push -u origin <branch>` (with `-u` flag)
- If a push fails due to network errors, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s)
- Fetch specific branches: `git fetch origin <branch-name>`

---

## Getting Help

- Report issues at: https://github.com/anthropics/claude-code/issues
- Use `/help` in Claude Code for usage assistance

---

*This CLAUDE.md was auto-generated on 2026-03-12 and should be updated as the project grows.*
