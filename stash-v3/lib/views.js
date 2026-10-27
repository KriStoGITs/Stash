import { roles } from './validation.js';

const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
}

// Route modules register navigation entries in their loading order.
export const links = [['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']]];

export function form(context, action, body, label = 'Saglabāt') {
  return `
    <form method="post" action="${action}">
      <input type="hidden" name="csrf" value="${esc(context.session.csrf)}">
      ${body}
      <button>${label}</button>
    </form>
  `;
}

export function input(label, name, value = '', type = 'text', attributes = '') {
  return `
    <label>${label}
      <input name="${name}" type="${type}" value="${esc(value)}" ${attributes}>
    </label>
  `;
}

function sidebar(context) {
  const { user, url } = context;
  const navigation = links
    .filter(([, , , allowedRoles]) => allowedRoles.includes(user.role))
    .map(([path, icon, label]) => `
      <a ${url.pathname === path ? 'aria-current="page"' : ''} href="${path}">
        <span>${icon}</span>${label}
      </a>
    `)
    .join('');

  return `
    <aside>
      <div class="brand">⌂STASH</div>
      <nav>
        ${navigation}
        ${form(context, '/logout', '', 'Iziet →')}
      </nav>
      <div class="identity">
        ${esc(user.name)}
        <small>${roles[user.role]}</small>
      </div>
    </aside>
  `;
}

export function page(context, title, body) {
  return `<!doctype html>
    <html lang="lv">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${esc(title)} · STASH</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        ${context.user ? sidebar(context) : ''}
        <main class="${context.user ? '' : 'login'}">
          <header>
            <p class="eyebrow">UZŅĒMUMA IEKŠĒJĀ LIETOTNE</p>
            <h1>${esc(title)}</h1>
          </header>
          ${body}
          <footer>STASH · Noliktavas vadības sistēma</footer>
        </main>
      </body>
    </html>
  `;
}

// Headers are plain text; cells contain HTML escaped or rendered by the caller.
export function table(headers, rows) {
  const heading = headers.map(header => `<th>${esc(header)}</th>`).join('');
  const body = rows.length
    ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">Nav ierakstu.</td></tr>`;

  return `
    <div class="table">
      <table>
        <thead><tr>${heading}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}
