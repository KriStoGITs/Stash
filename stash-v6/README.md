# STASH

An internal warehouse application with a Latvian interface. It uses Node.js's built-in HTTP server and SQLite, with server-rendered HTML and no runtime dependencies.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run setup
npm start
```

Setup creates the administrator, warehouse worker, and shelf sorter accounts and prints their generated passwords once. Save those passwords securely. Setup refuses to overwrite existing accounts.

The default address is http://127.0.0.1:3000. The database is created at `data/stash.sqlite`.

| Variable        | Default                     | Purpose                            |
| --------------- | --------------------------- | ---------------------------------- |
| `HOST`          | `127.0.0.1`                 | Listening interface                |
| `PORT`          | `3000`                      | Listening port                     |
| `DATA_DIR`      | Project's `data/` directory | SQLite storage directory           |
| `COOKIE_SECURE` | Unset                       | Set to `1` when serving over HTTPS |

## Code layout

- `server.js`: loads feature modules and dispatches HTTP requests.
- `core.js`: shared exports for feature modules.
- `lib/database.js`: schema, database connection, transactions, and audit logging.
- `lib/auth.js` and `lib/security.js`: login, sessions, logout, and password hashing.
- `lib/http.js`: form parsing, response helpers, cookies, and security headers.
- `lib/validation.js`: input validation and role checks.
- `lib/views.js` and `lib/escape.js`: shared HTML and escaping.
- `lib/dashboard.js`: home page statistics.
- `modules/`: products, users, orders, placement, and reports. Numeric prefixes determine sidebar order. Each module exports a `route(ctx)` function that returns `true` when it handles a request.
- `public/style.css`: shared styles.
- `tests/`: automated checks using a temporary database.

Orders reserve stock when created. Cancelling an order restores its reserved quantities. Database changes and their audit entries share a transaction.

## Development

```sh
npm test
npm run format
npm run format:check
```

The tests use a separate temporary database and do not modify application data. Prettier is a development dependency; the running application uses only Node.js built-ins.
