# STASH

A small warehouse management app with a Latvian interface. It uses Node.js, SQLite, and server-rendered HTML.

## Run locally

Use Node.js 24 or newer.

```sh
npm install
npm run setup
npm start
```

Open http://127.0.0.1:3000. Run setup once on a new database. It creates an administrator, a warehouse worker, and a shelf sorter, and prints their generated passwords. Save those passwords; setup refuses to overwrite existing accounts.

## Project layout

- `server.js` handles HTTP requests, sessions, and feature dispatch.
- `setup.js` creates the initial accounts.
- `modules/` contains the dashboard, products, users, orders, and placement features. Each feature keeps its request handlers and page content together.
- `lib/` contains database access, authentication, authorization, password hashing, validation, navigation, and HTML helpers.
- `core.js` re-exports shared helpers.
- `public/style.css` contains the page styles.
- `tests/app.test.js` checks the main workflows against a temporary database.

To add a feature, import it in `server.js` and include it in the `features` array. Add its sidebar entries in `lib/navigation.js`. Routes return `true` after sending a response and `false` when another feature should handle the request.

## Development

```sh
npm test
npm run format
npm run format:check
```

Tests create their own temporary database and remove it afterward.

## Configuration

| Variable        | Default                     | Purpose                               |
| --------------- | --------------------------- | ------------------------------------- |
| `HOST`          | `127.0.0.1`                 | Address to listen on                  |
| `PORT`          | `3000`                      | HTTP port                             |
| `DATA_DIR`      | Project's `data/` directory | Directory containing `stash.sqlite`   |
| `COOKIE_SECURE` | Unset                       | Set to `1` when serving through HTTPS |

Order quantities are reserved immediately. Cancelling an order returns those quantities to available stock. Product quantity edits change available stock directly. User account changes invalidate that user's sessions.
