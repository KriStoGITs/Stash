import { esc } from './escape.js';

export function form(ctx, action, body, label = 'Saglabāt') {
  return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${esc(ctx.session.csrf)}">${body}<button>${label}</button></form>`;
}

export function input(label, name, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}

export const roles = {
  admin: 'Administrators',
  worker: 'Noliktavas darbinieks',
  sorter: 'Plauktu kārtotājs',
};
export const links = [['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']]];
function sidebar(ctx) {
  const navigation = links
    .filter(([, , , allowedRoles]) => allowedRoles.includes(ctx.user.role))
    .map(([href, icon, label]) => {
      const current = ctx.url.pathname === href ? 'aria-current="page"' : '';
      return `<a ${current} href="${href}"><span>${icon}</span>${label}</a>`;
    })
    .join('');

  return `<aside>
    <div class="brand">⌂STASH</div>
    <nav>${navigation}${form(ctx, '/logout', '', 'Iziet →')}</nav>
    <div class="identity">${esc(ctx.user.name)}<small>${roles[ctx.user.role]}</small></div>
  </aside>`;
}

export function page(ctx, title, body) {
  return `<!doctype html>
<html lang="lv">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)} · STASH</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    ${ctx.user ? sidebar(ctx) : ''}
    <main class="${ctx.user ? '' : 'login'}">
      <header>
        <p class="eyebrow">UZŅĒMUMA IEKŠĒJĀ LIETOTNE</p>
        <h1>${esc(title)}</h1>
      </header>
      ${body}
      <footer>STASH · Noliktavas vadības sistēma</footer>
    </main>
  </body>
</html>`;
}

// Headers are plain text; callers escape cell values before adding HTML controls.
export function table(headers, rows) {
  const heading = headers.map((header) => `<th>${esc(header)}</th>`).join('');
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">Nav ierakstu.</td></tr>`;

  return `<div class="table">
    <table>
      <thead><tr>${heading}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}
