export function assert(ok, message, status = 400) {
  if (!ok) {
    const e = new Error(message);
    e.status = status;
    throw e;
  }
}
export function field(data, key, min = 1, max = 100) {
  const value = String(data.get(key) || '').trim();
  assert(
    value.length >= min && value.length <= max,
    `Laukam “${key}” jābūt ${min}–${max} rakstzīmēm.`,
  );
  return value;
}
export function integer(value, min = 0, max = 1000000) {
  assert(/^\d+$/.test(String(value)), 'Ievadiet veselu skaitli.');
  const n = Number(value);
  assert(Number.isSafeInteger(n) && n >= min && n <= max, `Skaitlim jābūt no ${min} līdz ${max}.`);
  return n;
}

export function allow(ctx, roles) {
  assert(ctx.user && roles.includes(ctx.user.role), 'Jums nav tiesību veikt šo darbību.', 403);
}
