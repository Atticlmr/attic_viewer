/**
 * Theme Handler - Handles theme change events
 */
import type { App } from '../App.js';

export class ThemeHandler {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Handle theme change
     */
    handleThemeChanged(theme: string): void {
        if (this.app.codeEditorManager) {
            this.app.codeEditorManager.updateTheme(theme);
        }
        if (this.app.state.currentModel && this.app.modelGraphView) {
            this.app.modelGraphView.drawModelGraph(this.app.state.currentModel);
        }
    }
}
