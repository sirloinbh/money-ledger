// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/public/에서
// Applies the saved light/dark choice before the first paint, so the page never flashes the other colours.
// Load it as a plain blocking script at the top of <head>: <script src="/theme-init.js"></script>
// The key and values match src/lib/theme.ts.
// darkOnly comes from the registry (features.darkOnly, ADR-0011): such an app is always dark.
/* global document */
(function () {
  var darkOnly = false;
  if (darkOnly) {
    document.documentElement.classList.add('dark');
    return;
  }
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.classList.add(saved);
  } catch {
    // Storage blocked: the system setting applies.
  }
})();
