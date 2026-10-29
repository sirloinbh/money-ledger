// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/에서
// 규칙 원본은 @sirloinbh/eslint-config 패키지다. 이 파일은 앱이 설치한 플러그인을 넘기기만 한다.
import js from '@eslint/js';
import { createConfig } from '@sirloinbh/eslint-config';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import importSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// .standards/ holds central scripts copied as they are; the central repository checks them.
// tsconfigRootDir turns on the type-aware rules (#244) for frontend/src and backend/src.
// Input (components/ui) renders a native <input>, so a <label> wrapping it counts as labelled.
export default [
  ...createConfig(
    { js, tseslint, globals, reactHooks, reactRefresh, jsxA11y, importSort, prettier },
    { ignores: ['.standards/**'], tsconfigRootDir: import.meta.dirname },
  ),
  { settings: { 'jsx-a11y-x': { components: { Input: 'input' } } } },
];
