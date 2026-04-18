/**
 * Drag State Manager
 * Used to apply forces when dragging objects during physics simulation
 */
import * as THREE from 'three';

interface OrbitLikeControls {
    enabled: boolean;
}

interface PhysicsRenderable extends THREE.Object3D {
    bodyID?: number;
}

type HighlightState = {
    color: THREE.Color;
    intensity: number;
};

function setMaterialTransparency(material: THREE.Material | THREE.Material[], opacity: number): void {
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((entry) => {
        entry.transparent = true;
        entry.opacity = opacity;
    });
}

export class DragStateManager {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.Camera;
    mousePos: THREE.Vector2;
    raycaster: THREE.Raycaster;
    grabDistance: number;
    active: boolean;
    physicsObject: PhysicsRenderable | null;
    controls: OrbitLikeControls;
    arrow: THREE.ArrowHelper;
    previouslySelected: PhysicsRenderable | null;
    highlightColor: number;
    originalEmissive: Map<string, HighlightState>;
    localHit: THREE.Vector3;
    worldHit: THREE.Vector3;
    currentWorld: THREE.Vector3;
    enabled: boolean;
    container: HTMLElement;
    boundOnPointer: (evt: PointerEvent) => void;
    mouseDown: boolean;

    constructor(
        scene: THREE.Scene,
        renderer: THREE.WebGLRenderer,
        camera: THREE.Camera,
        container: HTMLElement,
        controls: OrbitLikeControls
    ) {
        this.scene = scene;
        this.renderer = renderer;
        this.camera = camera;
        this.mousePos = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 0.1;
        this.grabDistance = 0.0;
        this.active = false;
        this.physicsObject = null;
        this.controls = controls;

        // Create force visualization arrow
        this.arrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            15,
            0x666666
        );
        this.arrow.setLength(15, 3, 1);
        this.scene.add(this.arrow);
        setMaterialTransparency(this.arrow.line.material, 0.5);
        setMaterialTransparency(this.arrow.cone.material, 0.5);
        this.arrow.visible = false;

        this.previouslySelected = null;
        this.highlightColor = 0xffffff; // White highlight
        this.originalEmissive = new Map(); // Save original materials

        this.localHit = new THREE.Vector3();
        this.worldHit = new THREE.Vector3();
        this.currentWorld = new THREE.Vector3();

        // Event listeners
        this.enabled = false; // Disabled by default, enabled during simulation
        this.container = container;
        this.boundOnPointer = this.onPointer.bind(this);
        this.mouseDown = false;
    }

    enable() {
        if (!this.enabled) {
            this.enabled = true;
            this.container.addEventListener('pointerdown', this.boundOnPointer, true);
            document.addEventListener('pointermove', this.boundOnPointer, true);
            document.addEventListener('pointerup', this.boundOnPointer, true);
            document.addEventListener('pointerout', this.boundOnPointer, true);
        }
    }

    disable() {
        if (this.enabled) {
            this.enabled = false;
            this.container.removeEventListener('pointerdown', this.boundOnPointer, true);
            document.removeEventListener('pointermove', this.boundOnPointer, true);
            document.removeEventListener('pointerup', this.boundOnPointer, true);
            document.removeEventListener('pointerout', this.boundOnPointer, true);

            if (this.active) {
                this.end();
            }
        }
    }

    updateRaycaster(x: number, y: number): void {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mousePos.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.mousePos.y = -((y - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mousePos, this.camera);
    }

    start(x: number, y: number): void {
        this.physicsObject = null;
        this.updateRaycaster(x, y);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        for (let i = 0; i < intersects.length; i++) {
            const obj = intersects[i].object as PhysicsRenderable;
            if (obj.bodyID !== undefined && obj.bodyID > 0) {
                this.physicsObject = obj;
                this.grabDistance = intersects[i].distance;
                const hit = this.raycaster.ray.origin.clone();
                hit.addScaledVector(this.raycaster.ray.direction, this.grabDistance);
                this.arrow.position.copy(hit);
                this.active = true;
                this.controls.enabled = false;
                this.localHit = obj.worldToLocal(hit.clone());
                this.worldHit.copy(hit);
                this.currentWorld.copy(hit);
                this.arrow.visible = true;

                // Highlight selected object
                this.highlightBody(obj);
                break;
            }
        }
    }

    move(x: number, y: number): void {
        if (this.active) {
            this.updateRaycaster(x, y);
            const hit = this.raycaster.ray.origin.clone();
            hit.addScaledVector(this.raycaster.ray.direction, this.grabDistance);
            this.currentWorld.copy(hit);
            this.update();
        }
    }

    update(): void {
        if (this.worldHit && this.localHit && this.currentWorld && this.arrow && this.physicsObject) {
            this.worldHit.copy(this.localHit);
            this.physicsObject.localToWorld(this.worldHit);
            this.arrow.position.copy(this.worldHit);
            this.arrow.setDirection(this.currentWorld.clone().sub(this.worldHit).normalize());
            this.arrow.setLength(this.currentWorld.clone().sub(this.worldHit).length());
        }
    }

    end(): void {
        // Remove highlight
        if (this.physicsObject) {
            this.unhighlightBody(this.physicsObject);
        }

        this.physicsObject = null;
        this.active = false;
        this.controls.enabled = true;
        this.arrow.visible = false;
        this.mouseDown = false;
    }

    /**
     * Highlight entire body group
     */
    highlightBody(obj: PhysicsRenderable): void {
        // Find body group (parent Group containing bodyID)
        let bodyGroup: THREE.Object3D | null = obj;
        while (bodyGroup && !(bodyGroup instanceof THREE.Group)) {
            bodyGroup = bodyGroup.parent;
        }

        if (!bodyGroup) return;

        // Traverse all meshes in body group and highlight
        bodyGroup.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material || Array.isArray(child.material)) {
                return;
            }

            const material = child.material;

            if (material.emissive) {
                // Only process materials with emissive property (e.g., MeshPhongMaterial, MeshStandardMaterial)
                if (!this.originalEmissive.has(child.uuid)) {
                    this.originalEmissive.set(child.uuid, {
                        color: material.emissive.clone(),
                        intensity: material.emissiveIntensity || 0
                    });
                }

                material.emissive.setHex(this.highlightColor);
                material.emissiveIntensity = 0.5;
            }
        });
    }

    /**
     * Remove highlight from body group
     */
    unhighlightBody(obj: PhysicsRenderable): void {
        // Find body group
        let bodyGroup: THREE.Object3D | null = obj;
        while (bodyGroup && !(bodyGroup instanceof THREE.Group)) {
            bodyGroup = bodyGroup.parent;
        }

        if (!bodyGroup) return;

        // Restore original materials
        bodyGroup.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material || Array.isArray(child.material)) {
                return;
            }

            const original = this.originalEmissive.get(child.uuid);
            if (!original || !child.material.emissive) {
                return;
            }

            child.material.emissive.copy(original.color);
            child.material.emissiveIntensity = original.intensity;
            this.originalEmissive.delete(child.uuid);
        });
    }

    onPointer(evt: PointerEvent): void {
        if (!this.enabled) return;

        if (evt.type === 'pointerdown') {
            this.start(evt.clientX, evt.clientY);
            this.mouseDown = true;
        } else if (evt.type === 'pointermove' && this.mouseDown) {
            if (this.active) {
                this.move(evt.clientX, evt.clientY);
            }
        } else if (evt.type === 'pointerup') {
            this.end();
        }
    }
}
