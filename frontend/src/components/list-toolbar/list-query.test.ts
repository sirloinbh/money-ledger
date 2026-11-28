// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/list-toolbar/
import { expect, test } from 'vitest';

import { formatListQuery, isListQueryChanged, parseListQuery } from './list-query';

const shape = {
  filters: { status: '' },
  sort: { default: 'newest' },
};

test('missing keys give the defaults', () => {
  expect(parseListQuery('', shape)).toEqual({
    search: '',
    filters: { status: '' },
    sort: 'newest',
  });
});

test('reads search, filter and sort from a string or URLSearchParams', () => {
  const expected = { search: 'bench', filters: { status: 'open' }, sort: 'name' };
  expect(parseListQuery('q=bench&status=open&sort=name', shape)).toEqual(expected);
  expect(parseListQuery(new URLSearchParams('q=bench&status=open&sort=name'), shape)).toEqual(
    expected,
  );
});

test('values equal to the default are left out and other parameters are kept', () => {
  const query = { search: ' bench ', filters: { status: '' }, sort: 'newest' };
  expect(formatListQuery(query, shape, 'tab=a&page=2')).toBe('tab=a&page=2&q=bench');
  expect(
    formatListQuery({ search: '', filters: { status: 'open' }, sort: 'name' }, shape, 'q=old'),
  ).toBe('status=open&sort=name');
});

test('a custom sort key is used', () => {
  const custom = { sort: { key: 'order', default: 'a' } };
  expect(parseListQuery('order=b', custom).sort).toBe('b');
  expect(formatListQuery({ search: '', filters: {}, sort: 'b' }, custom)).toBe('order=b');
});

test('format then parse gives the same state', () => {
  const query = { search: 'a b&c', filters: { status: 'done' }, sort: 'name' };
  expect(parseListQuery(formatListQuery(query, shape), shape)).toEqual(query);
});

test('isListQueryChanged compares with the defaults', () => {
  const base = { search: '', filters: { status: '' }, sort: 'newest' };
  expect(isListQueryChanged(base, shape)).toBe(false);
  expect(isListQueryChanged({ ...base, search: ' ' }, shape)).toBe(false);
  expect(isListQueryChanged({ ...base, filters: { status: 'open' } }, shape)).toBe(true);
  expect(isListQueryChanged({ ...base, sort: 'name' }, shape)).toBe(true);
});
