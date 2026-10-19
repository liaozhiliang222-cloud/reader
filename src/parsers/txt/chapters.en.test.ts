import { expect, it } from 'vitest';
import { isChapterTitle, splitChapters } from './chapters';

it('recognises common English chapter headings', () => {
  for (const line of [
    'Chapter 1',
    'CHAPTER ONE',
    'CHAPTER I.',
    'Chapter XII: The Storm',
    'Part 1',
    'PART TWO',
    'Prologue',
    'Epilogue.',
  ])
    expect(isChapterTitle(line), line).toBe(true);
  for (const line of [
    'Chapters of life',
    'Part of the problem was money.',
    'Prologues are tedious.',
  ])
    expect(isChapterTitle(line), line).toBe(false);
});

it('splits an English TXT on those headings', () => {
  const body = 'It was the best of times.\n\n';
  const chapters = splitChapters(
    `CHAPTER ONE\n\n${body}CHAPTER TWO\n\n${body}`,
  );
  expect(chapters.map((chapter) => chapter.title)).toEqual([
    'CHAPTER ONE',
    'CHAPTER TWO',
  ]);
});
