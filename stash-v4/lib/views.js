export const roles = {
  admin: 'Administrators',
  worker: 'Noliktavas darbinieks',
  sorter: 'Plauktu kārtotājs',
};

export const links = [['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']]];

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) => HTML_ENTITIES[character],
  );
}

export function form(ctx, action, body, label = 'Saglabāt') {
  return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${esc(ctx.session.csrf)}">${body}<button>${label}</button></form>`;
}

export function input(label, name, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}

function sidebar(ctx) {
  const { user, url } = ctx;
  const navigation = links
    .filter(([, , , allowedRoles]) => allowedRoles.includes(user.role))
    .map(([path, icon, label]) => {
      const current = url.pathname === path ? 'aria-current="page"' : '';
      return `<a ${current} href="${path}"><span>${icon}</span>${label}</a>`;
    })
    .join('');

  return [
    '<aside><div class="brand">⌂STASH</div><nav>',
    navigation,
    form(ctx, '/logout', '', 'Iziet →'),
    '</nav>',
    `<div class="identity">${esc(user.name)}<small>${roles[user.role]}</small></div>`,
    '</aside>',
  ].join('');
}

export function page(ctx, title, body) {
  return [
    '<!doctype html><html lang="lv"><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)} · STASH</title>`,
    '<link rel="stylesheet" href="/style.css"><body>',
    ctx.user ? sidebar(ctx) : '',
    `<main class="${ctx.user ? '' : 'login'}">`,
    '<header><p class="eyebrow">UZŅĒMUMA IEKŠĒJĀ LIETOTNE</p>',
    `<h1>${esc(title)}</h1></header>`,
    body,
    '<footer>STASH · Noliktavas vadības sistēma</footer>',
    '</main></body></html>',
  ].join('');
}

// Headers are escaped here; cells may contain HTML and are escaped by callers.
export function table(headers, rows) {
  const headings = headers.map((header) => `<th>${esc(header)}</th>`).join('');
  const content = rows.length
    ? rows
        .map(
          (row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
        )
        .join('')
    : `<tr><td colspan="${headers.length}">Nav ierakstu.</td></tr>`;

  return `<div class="table"><table><thead><tr>${headings}</tr></thead><tbody>${content}</tbody></table></div>`;
}
