# STASH

A server-rendered warehouse app built with Node.js and SQLite. The interface is in Latvian and access is controlled by three roles: administrator, warehouse worker, and shelf sorter.

## Run locally

Requires Node.js 24 or later. There are no runtime dependencies to install.

```sh
npm run setup
npm start
```

Setup creates the initial accounts and prints their generated passwords once. Save them securely. Run setup only for a new database; it refuses to overwrite existing accounts.

Open http://127.0.0.1:3000 and sign in.

## Code layout

- `server.js`: HTTP server, request pipeline, and feature dispatch.
- `modules/`: product, user, and order routes, each with named handlers for individual operations. Numeric prefixes determine loading and navigation order.
- `lib/auth.js`: login, session loading, cookies, and login attempt limits.
- `lib/database.js`: schema, database connection, audit logging, and transactions.
- `lib/passwords.js`: password hashing and verification.
- `lib/validation.js`: input validation and role checks.
- `lib/http.js`: bounded form-body parsing.
- `lib/views.js`: shared HTML, forms, tables, and navigation.
- `lib/dashboard.js`: dashboard data and rendering.
- `core.js`: shared exports used by feature modules and setup.
- `public/style.css`: responsive application styles.
- `tests/app.test.js`: regression tests using a temporary database and local HTTP server.

Feature routes return `true` after responding and `false` when the route does not match. Database mutations that must succeed together run inside `transaction()`. HTML table cells may include markup, so escape user values with `esc()` before passing them to `table()`.

## Configuration

| Variable        | Default                    | Purpose                               |
| --------------- | -------------------------- | ------------------------------------- |
| `DATA_DIR`      | `data/` beside `server.js` | SQLite storage directory              |
| `HOST`          | `127.0.0.1`                | Listening address                     |
| `PORT`          | `3000`                     | Listening port                        |
| `COOKIE_SECURE` | unset                      | Set to `1` when serving through HTTPS |

## Verify changes

```sh
npm test
npm run check
```

Tests cover login and lockout, role restrictions, CSRF, product management, order reservations and rollback, cancellation, user updates, and logout. They create and remove their own temporary database.

Formatting conventions are recorded in `.prettierrc.json`.
