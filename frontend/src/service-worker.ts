// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { toast } from './components/ui/sonner';

// #109: registers public/sw.js (centrally managed) and tells the user when a new version takes over.
// The worker never answers /api/ requests, so sign-in responses (#303) always come from the server.
type Container = Pick<ServiceWorkerContainer, 'controller' | 'addEventListener' | 'register'>;

export function registerServiceWorker(
  onUpdate: () => void = showUpdateNotice,
  container: Container = navigator.serviceWorker,
) {
  // The first install also fires controllerchange (sw.js claims open pages). Only a takeover of a
  // page that already had a worker means it runs an older version; later deploys while the tab
  // stays open are announced too (the notice has a fixed id, so it does not stack).
  let controlled = Boolean(container.controller);
  container.addEventListener('controllerchange', () => {
    if (controlled) onUpdate();
    controlled = true;
  });
  return container.register('/sw.js');
}

// No automatic reload: the open page may hold unsaved input (user decision in #109).
export function showUpdateNotice() {
  toast('A new version is available', {
    id: 'app-update',
    description: 'Reload when you are ready. Unsaved input on this page is not kept.',
    duration: Infinity,
    action: { label: 'Reload', onClick: () => location.reload() },
  });
}
