import type { TocEntry } from '@/parsers/epub/parse';
import type { Locator } from '@/types';

/** The nearest preceding section in this spine document; source order breaks ties. */
export function currentSection(
  toc: readonly TocEntry[] | undefined,
  locator: Locator,
) {
  let selected: TocEntry | undefined;
  for (const entry of toc ?? []) {
    if (
      entry.chapterIndex !== locator.chapterIndex ||
      entry.paragraphIndex > locator.paragraphIndex
    )
      continue;
    if (
      !selected ||
      entry.paragraphIndex > selected.paragraphIndex ||
      (entry.paragraphIndex === selected.paragraphIndex &&
        entry.level >= selected.level)
    )
      selected = entry;
  }
  return selected;
}
