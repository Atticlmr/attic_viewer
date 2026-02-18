/**
 * Application main entry point
 * Delegates to App class in src/app/
 */
import { App } from './app/App.js';

// Create and start application
const app = new App();
app.init();

// Expose to global (for debugging)
window.app = app;
