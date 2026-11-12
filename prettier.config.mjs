// Managed file. Edit it in sirloinbh/project-standards templates/app/
// The shared options come from the @sirloinbh/prettier-config package. This file only adds the plugins the app installed.
import shared from '@sirloinbh/prettier-config' with { type: 'json' };

// prettier-plugin-tailwindcss sorts Tailwind classes; it reads the theme from the app stylesheet (#244).
// tailwindPreserveWhitespace keeps the spaces around classes: without it the plugin turns
// `row${on ? ' top' : ''}` into `row${on ? 'top' : ''}`, which renders "rowtop" (#246).
export default {
  ...shared,
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './frontend/src/index.css',
  tailwindPreserveWhitespace: true,
};
