/**
 * Simulation Handler - Handles MuJoCo simulation events
 */
export class SimulationHandler {
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    /**
     * Handle MuJoCo reset
     */
    handleMujocoReset() {
        if (this.app.mujocoSimulationManager) {
            // Only reset simulation state, don't change run/pause state
            this.app.mujocoSimulationManager.reset();
        }
    }

    /**
     * Handle MuJoCo simulation toggle
     */
    async handleMujocoToggleSimulate() {
        // If simulation not loaded, load first
        if (!this.app.mujocoSimulationManager.hasScene() &&
            this.app.state.currentMJCFFile &&
            this.app.state.currentMJCFModel) {
            try {
                const xmlContent = await this.app.state.currentMJCFFile.text();

                // Load MuJoCo physics engine
                await this.app.mujocoSimulationManager.loadScene(
                    xmlContent,
                    this.app.state.currentMJCFFile.name,
                    this.app.fileHandler.getFileMap(),
                    this.app.state.currentMJCFModel
                );

                // Hide original model
                if (this.app.state.currentModel?.threeObject) {
                    this.app.state.currentModel.threeObject.visible = false;
                }

                // Start simulation immediately
                this.app.mujocoSimulationManager.startSimulation();
                return true;
            } catch (error) {
                console.error('MuJoCo scene loading failed:', error);
                return false;
            }
        }

        // Toggle simulation state
        if (this.app.mujocoSimulationManager) {
            const isSimulating = this.app.mujocoSimulationManager.toggleSimulation();

            // Toggle original model visibility
            if (this.app.state.currentModel?.threeObject) {
                this.app.state.currentModel.threeObject.visible = !isSimulating;
            }

            return isSimulating;
        }
        return false;
    }
}
