export function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}
export function readField(data, key, min = 1, max = 100) {
  const value = String(data.get(key) || '').trim();
  assert(
    value.length >= min && value.length <= max,
    `Laukam “${key}” jābūt ${min}–${max} rakstzīmēm.`,
  );
  return value;
}
export function parseInteger(value, min = 0, max = 1000000) {
  assert(/^\d+$/.test(String(value)), 'Ievadiet veselu skaitli.');
  const number = Number(value);
  assert(
    Number.isSafeInteger(number) && number >= min && number <= max,
    `Skaitlim jābūt no ${min} līdz ${max}.`,
  );
  return number;
}
