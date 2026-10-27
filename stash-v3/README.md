# STASH

A server-rendered warehouse application with a Latvian interface, SQLite storage,
and administrator, warehouse worker, and shelf sorter accounts. It uses only
Node.js built-in modules.

## Run locally

Install Node.js 24 or later, then run:

```sh
npm run setup
npm start
```

Setup creates the three initial accounts and prints their generated passwords.
Save these passwords; they are not displayed again. Setup refuses to overwrite
existing accounts.

The application listens at http://127.0.0.1:3000 by default.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| DATA_DIR | data/ beside server.js | Directory containing stash.sqlite |
| HOST | 127.0.0.1 | Address to listen on |
| PORT | 3000 | HTTP port |
| COOKIE_SECURE | unset | Set to 1 when serving over HTTPS |

Use the same DATA_DIR for setup and the server. Relative DATA_DIR paths resolve
from the working directory. The existing database schema and password format
are unchanged; no migration is needed for this refactor.

## Code layout

- server.js: module loading and request dispatch.
- setup.js: initial account creation.
- lib/database.js: database schema, transactions, and audit logging.
- lib/auth.js: login, rate limits, sessions, and logout.
- lib/passwords.js: password hashing and verification.
- lib/http.js: request parsing, response helpers, and security headers.
- lib/validation.js: form validation and role checks.
- lib/views.js: shared HTML rendering and navigation.
- lib/dashboard.js: home page statistics.
- modules/10-products.js: product listing, search, creation, editing, and deletion.
- modules/20-users.js: administrator account management.
- public/style.css: application styling.
- core.js: compatibility exports for route modules using the original shared API.

Feature modules are loaded alphabetically from modules/. Each exports
an async route(context) function that returns true after handling a request,
or false to let dispatch continue. Authenticated POST requests have already
passed the session CSRF check before reaching a module.

The context provides req, res, url, user, session, parsed POST data, send,
and redirect. Register sidebar entries through links in lib/views.js.
Escape user-provided values with esc before inserting them in HTML;
table cells accept rendered HTML.

Administrators manage users and can delete products. Administrators and workers
can create or edit products. Sorters can view products. The database also
retains the existing order tables and dashboard counts, though this project
does not include order routes.

## Tests

```sh
npm test
```

Tests start the server on an ephemeral local port and use temporary databases.
They cover authentication, CSRF, permissions, product and user changes,
session invalidation, transaction rollback, and initial setup. They do not
read or modify the application's data directory.
