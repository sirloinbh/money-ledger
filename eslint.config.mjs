// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/에서
// 규칙 원본은 @sirloinbh/eslint-config 패키지다. 이 파일은 앱이 설치한 플러그인을 넘기기만 한다.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import { createConfig } from '@sirloinbh/eslint-config';

// .standards/ holds central scripts copied as they are; the central repository checks them.
export default createConfig({ js, tseslint, globals, reactHooks, prettier }, { ignores: ['.standards/**'] });
