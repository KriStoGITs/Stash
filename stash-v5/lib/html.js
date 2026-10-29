import { roleLabels, navigationLinks } from './navigation.js';

const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

export function renderForm(ctx, action, body, label = 'Saglabāt') {
  return [
    `<form method="post" action="${action}">`,
    `<input type="hidden" name="csrf" value="${escapeHtml(ctx.session.csrf)}">`,
    body,
    `<button>${label}</button></form>`,
  ].join('');
}

export function renderInput(label, name, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
}

function renderSidebar(ctx) {
  const { user } = ctx;
  const navigation = navigationLinks
    .filter(([, , , allowedRoles]) => allowedRoles.includes(user.role))
    .map(([path, icon, label]) => {
      const current = ctx.url.pathname === path ? 'aria-current="page"' : '';
      return `<a ${current} href="${path}"><span>${icon}</span>${label}</a>`;
    })
    .join('');

  return [
    '<aside><div class="brand">⌂STASH</div><nav>',
    navigation,
    renderForm(ctx, '/logout', '', 'Iziet →'),
    `</nav><div class="identity">${escapeHtml(user.name)}`,
    `<small>${roleLabels[user.role]}</small></div></aside>`,
  ].join('');
}

export function renderPage(ctx, title, body) {
  return [
    '<!doctype html><html lang="lv"><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)} · STASH</title>`,
    '<link rel="stylesheet" href="/style.css"><body>',
    ctx.user ? renderSidebar(ctx) : '',
    `<main class="${ctx.user ? '' : 'login'}">`,
    '<header><p class="eyebrow">UZŅĒMUMA IEKŠĒJĀ LIETOTNE</p>',
    `<h1>${escapeHtml(title)}</h1></header>`,
    body,
    '<footer>STASH · Noliktavas vadības sistēma</footer></main></body></html>',
  ].join('');
}

// Cells contain markup assembled by callers; escape untrusted text before passing it here.
export function renderTable(headers, rows) {
  const heading = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">Nav ierakstu.</td></tr>`;

  return `<div class="table"><table><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table></div>`;
}
