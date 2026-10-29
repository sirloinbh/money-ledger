// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/에서
// 공통 옵션 원본은 @sirloinbh/prettier-config 패키지다. 이 파일은 앱이 설치한 플러그인을 더하기만 한다.
import shared from '@sirloinbh/prettier-config' with { type: 'json' };

// prettier-plugin-tailwindcss sorts Tailwind classes; it reads the theme from the app stylesheet (#244).
export default { ...shared, plugins: ['prettier-plugin-tailwindcss'], tailwindStylesheet: './frontend/src/index.css' };
