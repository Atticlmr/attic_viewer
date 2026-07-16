/**
 * Application main entry point
 * Delegates to App class in src/app/
 */
import { App } from './app/App.js';

// Create and start application
const app = new App();
void app.init();

// Expose to global (for debugging)
window.app = app;

if (import.meta.hot) {
    import.meta.hot.dispose(() => app.dispose());
}
