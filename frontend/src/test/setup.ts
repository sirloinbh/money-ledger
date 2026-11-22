// The shared screen-test setup (managed, #255): the jest-dom matchers, jsdom stand-ins (matchMedia,
// ResizeObserver), an 8-second wait for findBy* and waitFor instead of Testing Library's 1 second, and a clean
// slate after each test (cleanup, real timers, globals, mocks, localStorage, the html class, the URL).
// Add below only what is specific to this app; this app needs nothing more today.
import './standard-setup';
