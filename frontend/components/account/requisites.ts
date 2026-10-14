// Checks of Russian company requisites, the same as the API's (backend/app/models/organizations.py):
// the form says what is wrong before the request.

/** Digits and letters only: "7707 083 893" -> "7707083893". */
export function compact(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function checkDigit(digits: number[], weights: number[]): number {
  return (weights.reduce((sum, w, i) => sum + w * digits[i], 0) % 11) % 10;
}

/** ИНН: 10 digits for a company, 12 for a person or a sole trader, with the check digits. */
export function validInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false;
  const d = [...inn].map(Number);
  if (d.length === 10) return checkDigit(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return checkDigit(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && checkDigit(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

/** ОГРН of a company (13 digits) or ОГРНИП of a sole trader (15), with the check digit. */
export function validOgrn(ogrn: string): boolean {
  if (/^\d{13}$/.test(ogrn)) return (Number(ogrn.slice(0, 12)) % 11) % 10 === Number(ogrn[12]);
  if (/^\d{15}$/.test(ogrn)) return (Number(ogrn.slice(0, 14)) % 13) % 10 === Number(ogrn[14]);
  return false;
}

export const KPP = /^\d{4}[\dA-Z]{2}\d{3}$/;

/** What is wrong with an ИНН, for the forms; undefined when it is fine. */
export function innError(inn: string): string | undefined {
  if (!inn) return "Укажите ИНН";
  if (!/^(\d{10}|\d{12})$/.test(inn)) return "ИНН — 10 цифр у организации или 12 у ИП";
  if (!validInn(inn)) return "Контрольная цифра ИНН не сходится — похоже, в номере опечатка";
  return undefined;
}
