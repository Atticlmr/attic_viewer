/**
 * Theme Handler - Handles theme change events
 */
export class ThemeHandler {
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    /**
     * Handle theme change
     */
    handleThemeChanged(theme) {
        if (this.app.codeEditorManager) {
            this.app.codeEditorManager.updateTheme(theme);
        }
        if (this.app.state.currentModel && this.app.modelGraphView) {
            this.app.modelGraphView.drawModelGraph(this.app.state.currentModel);
        }
    }
}
