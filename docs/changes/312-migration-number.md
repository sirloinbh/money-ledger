# Fix the duplicate migration number 043 (#312)

`043_kakao_commands_strategy.sql` (PR #334) and `043_daily_picks.sql` (#308) were both merged with number 043, and the migration runner refuses two files with one number (`Two migration files share a number`), so `npm run db:migrate` failed on main.

The Kakao file was never applied outside local test databases (deployment is not connected), so it is renumbered to `045_kakao_commands_strategy.sql`. 044 is left for `043_mock_position_questions.sql` of PR #332 (#310), which collides too and needs its own renumbering. The test and the change record of #334 name the new file.

## Verification

- `npm run db:migrate` on a fresh Postgres 17 container applies every file; `npm run check` passes.
