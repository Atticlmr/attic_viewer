import * as THREE from 'three';

interface DisposalOptions {
    preserveTextures?: Set<THREE.Texture>;
    disposeTextures?: boolean;
}

function disposeTexture(texture: THREE.Texture, disposedTextures: Set<THREE.Texture>, preserveTextures: Set<THREE.Texture>): void {
    if (disposedTextures.has(texture) || preserveTextures.has(texture)) {
        return;
    }

    disposedTextures.add(texture);
    const image = texture.image as { close?: () => void } | undefined;
    image?.close?.();
    texture.dispose();
}

function disposeMaterial(
    material: THREE.Material,
    disposedMaterials: Set<THREE.Material>,
    disposedTextures: Set<THREE.Texture>,
    preserveTextures: Set<THREE.Texture>,
    shouldDisposeTextures: boolean
): void {
    if (disposedMaterials.has(material)) {
        return;
    }

    disposedMaterials.add(material);

    if (shouldDisposeTextures) {
        Object.values(material).forEach(value => {
            if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
                disposeTexture(value as THREE.Texture, disposedTextures, preserveTextures);
            }
        });

        const uniforms = (material as THREE.ShaderMaterial).uniforms;
        if (uniforms) {
            Object.values(uniforms).forEach(uniform => {
                const value = uniform?.value;
                if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
                    disposeTexture(value as THREE.Texture, disposedTextures, preserveTextures);
                }
            });
        }
    }

    material.dispose();
}

export function disposeObject3D(root: THREE.Object3D | null | undefined, options: DisposalOptions = {}): void {
    if (!root) {
        return;
    }

    const disposedGeometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    const disposedTextures = new Set<THREE.Texture>();
    const preserveTextures = options.preserveTextures || new Set<THREE.Texture>();
    const shouldDisposeTextures = options.disposeTextures !== false;

    root.traverse(object => {
        const renderable = object as THREE.Object3D & {
            geometry?: THREE.BufferGeometry;
            material?: THREE.Material | THREE.Material[];
            skeleton?: { dispose?: () => void };
        };

        if (renderable.geometry && !disposedGeometries.has(renderable.geometry)) {
            disposedGeometries.add(renderable.geometry);
            renderable.geometry.dispose();
        }

        const materials = Array.isArray(renderable.material)
            ? renderable.material
            : renderable.material
                ? [renderable.material]
                : [];

        materials.forEach(material => {
            disposeMaterial(material, disposedMaterials, disposedTextures, preserveTextures, shouldDisposeTextures);
        });

        renderable.skeleton?.dispose?.();
    });
}

export function disposeViewerModel(model: { threeObject?: THREE.Object3D | null } | null | undefined, preserveTextures?: Set<THREE.Texture>): void {
    disposeObject3D(model?.threeObject, { preserveTextures });
}
