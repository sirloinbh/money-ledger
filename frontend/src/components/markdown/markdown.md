<!-- Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/markdown/ -->

# Markdown

Shows user-written text safely. The parser (`parse.ts`) builds plain data and the component turns it into React elements, so the text can never add markup, images, scripts or event handlers. Syntax that is not listed here appears as plain text. Each row has a test in `markdown.test.tsx`.

| Syntax                        | Result                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `# Title` to `#### Title`     | Heading. `#` is `h2` by default (`headingStart` 2 to 4); the page owns `h1`      |
| blank line                    | New paragraph. A single new line is a line break                                 |
| `**bold**`, `__bold__`        | Strong                                                                           |
| `*soft*`, `_soft_`            | Emphasis (not inside a word, so `snake_case` stays text)                         |
| `` `code` ``                  | Inline code                                                                      |
| `- item`, `* item`, `+ item`  | Bullet list (one level)                                                          |
| `1. item`, `1) item`          | Numbered list (one level)                                                        |
| `> quote`                     | Block quote (may hold other blocks)                                              |
| ` ``` ` fence                 | Code block, shown exactly; an unclosed fence runs to the end                     |
| `---`, `***`, `___`           | Horizontal rule                                                                  |
| `[text](https://example.com)` | Link that opens in a new tab. Only `http` and `https`; others keep the text only |
| `\*`                          | Escapes a Markdown character                                                     |

Not supported on purpose: raw HTML, images, tables, nested lists, footnotes, autolinks. Add a row and a test before adding syntax.
