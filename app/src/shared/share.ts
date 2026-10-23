/** Share's destinations in their usual order, with the one used last moved to the top. An unknown `last` changes nothing. */
export function shareOrder<T extends string>(ids: readonly T[], last: string | null): T[] {
  const i = last === null ? -1 : ids.indexOf(last as T)
  return i <= 0 ? [...ids] : [ids[i], ...ids.slice(0, i), ...ids.slice(i + 1)]
}
