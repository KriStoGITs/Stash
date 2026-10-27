export const roles = {
  admin: 'Administrators',
  worker: 'Noliktavas darbinieks',
  sorter: 'Plauktu kārtotājs',
};

export function assert(condition, message, status = 400) {
  if (condition) return;

  const error = new Error(message);
  error.status = status;
  throw error;
}

export function field(data, key, min = 1, max = 100) {
  const value = String(data.get(key) || '').trim();
  assert(
    value.length >= min && value.length <= max,
    `Laukam “${key}” jābūt ${min}–${max} rakstzīmēm.`,
  );
  return value;
}

export function integer(value, min = 0, max = 1_000_000) {
  assert(/^\d+$/.test(String(value)), 'Ievadiet veselu skaitli.');

  const number = Number(value);
  assert(
    Number.isSafeInteger(number) && number >= min && number <= max,
    `Skaitlim jābūt no ${min} līdz ${max}.`,
  );
  return number;
}

export function allow(context, allowedRoles) {
  assert(
    context.user && allowedRoles.includes(context.user.role),
    'Jums nav tiesību veikt šo darbību.',
    403,
  );
}
