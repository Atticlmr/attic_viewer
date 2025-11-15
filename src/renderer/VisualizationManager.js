import * as THREE from 'three';

/**
 * VisualizationManager - Handles visual and collision mesh extraction and visibility
 */
export class VisualizationManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.visualMeshes = [];
        this.collisionMeshes = [];
        this.colliders = [];
        this.hiddenLinks = new Set();

        // Display states
        this.showVisual = true;
        this.showCollision = false;
        this.showShadow = true;
    }

    /**
     * Extract visual and collision meshes from model
     */
    extractVisualAndCollision(model) {
        // Clear previous mesh arrays
        this.visualMeshes = [];
        this.collisionMeshes = [];
        this.colliders = [];

        if (!model.threeObject) return;
        // Step 1: Collect all colliders and apply current display state
        model.threeObject.traverse((child) => {
            if (child.isURDFCollider) {
                this.colliders.push(child);
                child.visible = this.showCollision;
            }
        });
        // Step 2: Process collider materials
        this.colliders.forEach(collider => {
            collider.traverse((child) => {
                if (child.isMesh) {
                    // Save original material
                    if (!child.userData.originalMaterial) {
                        child.userData.originalMaterial = child.material;
                    }

                    // Set collision-specific material (semi-transparent yellow)
                    child.material = new THREE.MeshPhongMaterial({
                        transparent: true,
                        opacity: 0.35,
                        shininess: 2.5,
                        premultipliedAlpha: true,
                        color: 0xffbe38,
                        polygonOffset: true,
                        polygonOffsetFactor: -1,
                        polygonOffsetUnits: -1,
                    });

                    child.castShadow = false;
                    child.receiveShadow = false;

                    // Disable raycasting for colliders (don't interfere with dragging)
                    child.raycast = () => {};

                    this.collisionMeshes.push(child);
                }
            });
        });

        // Step 3: Collect all visual meshes
        let skippedCount = 0;
        let visualContainers = 0;

        model.threeObject.traverse((child) => {
            // Count URDFVisual containers
            if (child.isURDFVisual) {
                visualContainers++;
            }

            // Process Mesh objects
            if (child.isMesh || child.type === 'Mesh') {
                // Check if self or parent is a collider
                let isInCollider = false;
                let checkNode = child;
                while (checkNode) {
                    if (checkNode.isURDFCollider) {
                        isInCollider = true;
                        break;
                    }
                    checkNode = checkNode.parent;
                }

                // Only add non-collider meshes
                if (!isInCollider) {
                    // Convert MeshBasicMaterial to MeshPhongMaterial (supports lighting and shadows)
                    if (child.material && child.material.type === 'MeshBasicMaterial') {
                        const oldMaterial = child.material;
                        child.material = new THREE.MeshPhongMaterial({
                            color: oldMaterial.color,
                            map: oldMaterial.map,
                            transparent: oldMaterial.transparent,
                            opacity: oldMaterial.opacity,
                            side: oldMaterial.side,
                            shininess: 30
                        });
                        // Ensure correct color space for textures
                        if (child.material.map) {
                            child.material.map.colorSpace = THREE.SRGBColorSpace;
                        }
                    }

                    // Force set shadow properties (according to current state)
                    child.castShadow = this.showShadow;
                    child.receiveShadow = this.showShadow;
                    child.visible = this.showVisual;
                    this.visualMeshes.push(child);
                } else {
                    skippedCount++;
                }
            }
        });
    }

    /**
     * Toggle visual mesh visibility
     */
    toggleVisual(show, currentModel) {
        this.showVisual = show;

        // Update all visual meshes, considering individually hidden links
        if (currentModel && currentModel.links) {
            currentModel.links.forEach((link, linkName) => {
                if (link.threeObject) {
                    // If link is individually hidden, keep it hidden; otherwise follow global setting
                    const shouldBeVisible = show && !this.hiddenLinks.has(linkName);
                    this.setLinkVisibility(link.threeObject, shouldBeVisible, currentModel);
                }
            });
        }
    }

    /**
     * Toggle collision mesh visibility
     */
    toggleCollision(show) {
        this.showCollision = show;
        // Set visibility for both collider parent objects and internal meshes
        if (this.colliders) {
            this.colliders.forEach(collider => {
                collider.visible = show;
            });
        }
        this.collisionMeshes.forEach(mesh => {
            mesh.visible = show;
        });
    }

    /**
     * Toggle shadow casting/receiving
     */
    toggleShadow(show, renderer, directionalLight) {
        this.showShadow = show;

        // Update renderer shadow settings
        renderer.shadowMap.enabled = show;

        // Update light shadow casting
        if (directionalLight) {
            directionalLight.castShadow = show;
        }

        // Update all visual meshes shadow casting/receiving
        this.visualMeshes.forEach(mesh => {
            mesh.castShadow = show;
            mesh.receiveShadow = show;
        });

        // Clear shadow map if disabling (ensures immediate effect)
        if (!show && directionalLight && directionalLight.shadow) {
            directionalLight.shadow.map?.dispose();
            directionalLight.shadow.map = null;
        }
    }

    /**
     * Toggle individual link visibility
     */
    toggleLinkVisibility(linkName, currentModel) {
        if (!currentModel || !currentModel.links) {
            return false;
        }

        const link = currentModel.links.get(linkName);
        if (!link || !link.threeObject) {
            return false;
        }

        // Toggle hidden state
        const isHidden = this.hiddenLinks.has(linkName);
        if (isHidden) {
            this.hiddenLinks.delete(linkName);
        } else {
            this.hiddenLinks.add(linkName);
        }

        const newVisibility = !isHidden ? false : true;

        // Update link's all visual mesh visibility (including fixed child links)
        this.setLinkVisibility(link.threeObject, newVisibility, currentModel);
        return newVisibility;
    }

    /**
     * Check if link is hidden
     */
    isLinkHidden(linkName) {
        return this.hiddenLinks.has(linkName);
    }

    /**
     * Set link and its fixed child links visibility
     */
    setLinkVisibility(linkObject, visible, currentModel) {
        // Recursively traverse link and its fixed child links
        const traverseNonRecursive = (obj, isRoot = false) => {
            // If not root and is URDFLink, stop (this is a non-fixed child link)
            if (!isRoot && (obj.type === 'URDFLink' || obj.isURDFLink)) {
                return;
            }

            // If is URDFJoint
            if (obj.isURDFJoint || obj.type === 'URDFJoint') {
                // Check if it's a fixed joint
                const jointName = obj.name;
                let isFixed = false;

                if (jointName && currentModel?.joints && currentModel.joints.has(jointName)) {
                    const joint = currentModel.joints.get(jointName);
                    isFixed = (joint.type === 'fixed');
                }

                if (isFixed) {
                    // Continue traversing fixed joint's children (merged display)
                    for (const child of obj.children) {
                        traverseNonRecursive(child, false);
                    }
                    return;
                } else {
                    // Encountered movable joint, stop
                    return;
                }
            }

            // Skip auxiliary visualization objects and their entire subtrees
            if (this.isAuxiliaryVisualization(obj) || obj.userData?.isCenterOfMass || obj.userData?.isInertiaBox) {
                return; // Skip completely, don't process children
            }

            // Skip coordinate axes (should be independent of visual display)
            if (obj.name && obj.name.endsWith('_axes')) {
                return; // Skip coordinate axes and their children
            }

            // Process mesh
            if (obj.type === 'Mesh' || obj.isMesh) {
                // Skip collision mesh
                if (obj.isURDFCollider || obj.userData?.isCollision) {
                    return;
                }

                // Set visibility (only affects visual meshes, considering global showVisual state)
                obj.visible = visible && this.showVisual;
            }

            // Recursively process children
            for (const child of obj.children) {
                traverseNonRecursive(child, false);
            }
        };

        // Start traversing from root link
        traverseNonRecursive(linkObject, true);
    }

    /**
     * Check if object is auxiliary visualization object (should not be highlighted)
     */
    isAuxiliaryVisualization(obj) {
        // Check if in auxiliary object lists (will be set by InertialVisualization)
        if (obj.userData?.isInertiaBox) return true;
        if (obj.userData?.isCOMMarker) return true;
        if (obj.userData?.isCollision) return true;

        return false;
    }

    /**
     * Update visual model transparency
     * When COM, axes, or joint axes are enabled, set model to semi-transparent
     * Note: Only affects robot models with joints, not single meshes
     */
    updateVisualTransparency(showCOM, showAxes, showJointAxes, isSingleMesh) {
        // Single mesh doesn't need transparency effect
        if (isSingleMesh) {
            return;
        }

        // Check if any feature is enabled
        const shouldBeTransparent = showCOM || showAxes || showJointAxes;
        // Traverse all visual meshes and set transparency
        this.visualMeshes.forEach((mesh, index) => {
            VisualizationManager.setMeshTransparency(mesh, shouldBeTransparent, index);
        });
    }

    /**
     * Static method: Set mesh transparency
     * @param {THREE.Mesh} mesh - The mesh to set transparency on
     * @param {boolean} shouldBeTransparent - Whether to make transparent
     * @param {number} index - Optional index for logging
     */
    static setMeshTransparency(mesh, shouldBeTransparent, index = -1) {
        if (!mesh.material) {
            return;
        }

        // Handle material array case
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        materials.forEach(material => {
            // Save original material info (if not already saved)
            // Must save on first call, regardless of whether transparency is needed
            if (material.userData.originalOpacity === undefined) {
                material.userData.originalOpacity = material.opacity !== undefined ? material.opacity : 1.0;
                material.userData.originalTransparent = material.transparent || false;
            }

            if (shouldBeTransparent) {
                // Set semi-transparent
                material.transparent = true;
                material.opacity = 0.5;
                material.needsUpdate = true;
            } else {
                // Restore original state
                if (material.userData.originalOpacity !== undefined) {
                    material.opacity = material.userData.originalOpacity;
                    material.transparent = material.userData.originalTransparent;
                    material.needsUpdate = true;
                }
            }
        });
    }

    /**
     * Clear all meshes
     */
    clear() {
        this.visualMeshes = [];
        this.collisionMeshes = [];
        this.colliders = [];
        this.hiddenLinks.clear();
    }
}

