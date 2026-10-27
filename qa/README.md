# QA — full-system testing without touching company data

Everything here runs on a **throwaway local database** (`mongodb://127.0.0.1:27099/qa`).
The backend is started from an empty folder with `env -i`, so `backend/.env` (the
production database and secrets) is never read. `qa/guard.js` makes every script
refuse any other database or host.

```bash
./qa/start-local.sh            # local db + API (5055) + web dev (3055); --no-web for API only
node qa/seed.js                # DROP the local QA db, then 74 role users + fake records for every model
node qa/api-sweep.js           # every GET endpoint × every role → qa/out/api-sweep.json
node qa/page-sweep.js          # every page × every role in a browser → qa/out/page-sweep.json
```

For a faster page sweep, use a production build of the web:

```bash
cd frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:5055 BUILD_ID_OVERRIDE=qa-local npx next build \
  && npx next start -p 3055 -H 127.0.0.1
```

- Logins: `qa-<role>@local.test` / `QaTest@12345`.
- Output goes to `qa/out/`, and the database to `qa/.data/`. Both are git-ignored.
- External services point at a dead address on purpose (ops platform, Wialon). Mail is
  written to JSON, never sent.
- Agent: `.claude/agents/qa-tester.md`. Ask Claude Code: *"use qa-tester and test the Collections section"*.
