/** 相同ID记录的时间冲突：新者胜出，时间相同保留本机记录。 */
export function newest<T extends { bookId: string }>(
  local: T | undefined,
  incoming: T,
  time: (record: T) => number,
): T {
  if (local && local.bookId !== incoming.bookId)
    throw new Error('标注ID与本机其他书籍冲突，未修改本地数据。');
  return !local || time(incoming) > time(local) ? incoming : local;
}
