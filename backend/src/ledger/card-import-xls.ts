import { read, utils } from 'xlsx';

// #57 Reads the one sheet of a card usage file (.xls, or .xlsx) into rows of text. This is the only place that
// touches the xlsx package: the file comes from the user's own download, is capped at 5 MB by the router, and is
// never stored. The sheet logic is in card-import-parse.ts, which takes plain rows.

/** Every row of the first sheet as text, as the sheet shows it (so "1,234" stays "1,234"); empty cells are ''. */
export function readCardSheet(file: Buffer): string[][] {
  const book = read(file, { type: 'buffer', cellFormula: false, cellHTML: false, bookVBA: false });
  const name = book.SheetNames[0];
  if (!name) throw new Error('The file has no sheet');
  const rows = utils.sheet_to_json<unknown[]>(book.Sheets[name], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });
  return rows.map((row) => row.map((cell) => String(cell ?? '')));
}
