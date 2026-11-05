export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function form(ctx, action, body, label = 'Saglabāt') {
  return /* HTML */ `
    <form method="post" action="${action}">
      <input type="hidden" name="csrf" value="${esc(ctx.session.csrf)}" />
      ${body}
      <button>${label}</button>
    </form>
  `;
}
export function input(label, name, value = '', type = 'text', extra = '') {
  return /* HTML */ `
    <label>
      ${label}
      <input name="${name}" type="${type}" value="${esc(value)}" ${extra} />
    </label>
  `;
}
export const roles = {
  admin: 'Administrators',
  worker: 'Noliktavas darbinieks',
  sorter: 'Plauktu kārtotājs',
};
export const links = [
  ['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']],
  ['/products', '▤', 'Preces', ['admin', 'worker', 'sorter']],
  ['/users', '♙', 'Lietotāji', ['admin']],
  ['/orders', '♧', 'Pasūtījumi', ['worker']],
  ['/placement', '▦', 'Izvietojums', ['sorter', 'admin']],
  ['/reports', '▤', 'Atskaites', ['admin', 'worker', 'sorter']],
];
const iconPaths = {
  '⌂': 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  '▤': 'M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18',
  '♧': 'M2 5h12v12H2ZM14 9h4l4 4v4h-8M5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  '+': 'M12 4v16M4 12h16',
  '♙': 'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M3 21v-3c0-5 18-5 18 0v3Z',
  '▦': 'M3 3h18v18H3ZM3 12h18M8 6v6M16 6v6M8 15v6M16 15v6',
};
export const icon = (key) => /* HTML */ `
  <svg
    class="icon"
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="${iconPaths[key] || iconPaths['▤']}" />
  </svg>
`;
export function page(ctx, title, body) {
  const { user } = ctx;
  const navigation = user
    ? links
        .filter(([, , , allowedRoles]) => allowedRoles.includes(user.role))
        .map(
          ([href, symbol, label]) => /* HTML */ `
            <a
              ${ctx.url.pathname === href ||
              (href !== '/' && ctx.url.pathname.startsWith(href + '/')) ||
              (href === '/reports' && ctx.url.pathname === '/reports.csv')
                ? 'aria-current="page"'
                : ''}
              href="${href}"
            >
              <span class="nav-icon">${icon(symbol)}</span>
              ${esc(label)}
            </a>
          `,
        )
        .join('')
    : '';
  const sidebar = user
    ? /* HTML */ `
        <aside>
          <div class="brand">
            ${icon('⌂')}
            <span>STASH</span>
          </div>
          <nav aria-label="Galvenā izvēlne">${navigation}</nav>
          <div class="identity">
            ${esc(user.name)}
            <small>${roles[user.role]}</small>
            ${form(ctx, '/logout', '', 'Iziet')}
          </div>
        </aside>
      `
    : '';

  return /* HTML */ `
    <!doctype html>
    <html lang="lv">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${esc(title)} · STASH</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        ${sidebar}
        <main class="${user ? '' : 'login'}">
          <header>
            <h1>${esc(title)}</h1>
          </header>
          ${body}
          <footer>STASH · Noliktava</footer>
        </main>
      </body>
    </html>
  `;
}

// Cells intentionally accept HTML for forms and links. Escape plain data with esc().
export function table(headers, rows) {
  const heading = headers
    .map(
      (header) => /* HTML */ `
        <th scope="col">${esc(header)}</th>
      `,
    )
    .join('');
  const content = rows.length
    ? rows
        .map(
          (row) => /* HTML */ `
            <tr>
              ${row
                .map(
                  (cell) => /* HTML */ `
                    <td>${cell}</td>
                  `,
                )
                .join('')}
            </tr>
          `,
        )
        .join('')
    : /* HTML */ `
        <tr>
          <td colspan="${headers.length}">Nav ierakstu.</td>
        </tr>
      `;
  return /* HTML */ `
    <div class="table">
      <table>
        <thead>
          <tr>${heading}</tr>
        </thead>
        <tbody>${content}</tbody>
      </table>
    </div>
  `;
}
