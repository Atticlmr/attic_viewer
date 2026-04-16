import type {
    ConversionLossItem,
    ConversionMessage,
    FormatSerializer,
    GeneratedArtifact,
    GeometryElement,
    JointNode,
    MaterialDefinition,
    MeshGeometry,
    RobotIRDocument,
    SerializeContext,
    SerializeResult,
    SerializeTarget,
    Transform,
    Vec3,
    Vec4
} from '../converter.js';

type MJCFEqualitySemantic = {
    type?: string;
    name?: string;
    joint1?: string;
    joint2?: string;
    polycoef?: number[];
};

type MJCFActuatorSemantic = {
    type?: string;
    name?: string;
    joint?: string;
    gear?: number | number[];
    attributes?: Record<string, unknown>;
    children?: { tag: string; textContent?: string; attributes?: Record<string, unknown>; }[];
};

export class URDFSerializer implements FormatSerializer {
    async serialize(document: RobotIRDocument, _target: SerializeTarget, _context: SerializeContext = {}): Promise<SerializeResult> {
        const messages: ConversionMessage[] = [];
        const losses: ConversionLossItem[] = [];
        const meshExportPaths = collectMeshExportPaths(document);
        const artifacts = collectMeshArtifacts(document, meshExportPaths);
        const lines: string[] = [];
        const visualsByLink = groupByLink(document.geometry.visuals);
        const collisionsByLink = groupByLink(document.geometry.collisions);
        const physicsByLink = new Map(document.physics.links.map(item => [item.link, item]));
        const materialMap = new Map(document.materials.materials.map(item => [item.name, item]));
        const mimicMap = collectMimicMap(document, messages, losses);
        const transmissions = collectTransmissions(document, messages, losses);

        lines.push('<?xml version="1.0"?>');
        lines.push(`<robot name="${escapeXmlAttr(document.metadata.name || 'robot')}">`);

        document.materials.materials.forEach(material => {
            const serialized = serializeTopLevelMaterial(material, losses);
            if (serialized.length > 0) {
                lines.push(...serialized.map(line => indent(1, line)));
            }
        });

        document.structure.links.forEach(link => {
            lines.push(indent(1, `<link name="${escapeXmlAttr(link.name)}">`));

            const physics = physicsByLink.get(link.name);
            if (physics) {
                lines.push(...serializeInertial(physics, losses).map(line => indent(2, line)));
            }

            visualsByLink.get(link.name)?.forEach(visual => {
                lines.push(...serializeGeometryElement(visual, 'visual', materialMap, losses, meshExportPaths).map(line => indent(2, line)));
            });

            collisionsByLink.get(link.name)?.forEach(collision => {
                lines.push(...serializeGeometryElement(collision, 'collision', materialMap, losses, meshExportPaths).map(line => indent(2, line)));
            });

            lines.push(indent(1, '</link>'));
        });

        document.structure.joints.forEach(joint => {
            lines.push(...serializeJoint(joint, mimicMap.get(joint.name), losses).map(line => indent(1, line)));
        });

        transmissions.forEach(transmission => {
            lines.push(...transmission.map(line => indent(1, line)));
        });

        lines.push('</robot>');

        return {
            format: 'urdf',
            content: lines.join('\n'),
            mimeType: 'application/xml',
            messages,
            losses,
            artifacts
        };
    }
}

function groupByLink(items: GeometryElement[]): Map<string, GeometryElement[]> {
    const grouped = new Map<string, GeometryElement[]>();
    items.forEach(item => {
        if (!grouped.has(item.link)) {
            grouped.set(item.link, []);
        }
        grouped.get(item.link)?.push(item);
    });
    return grouped;
}

function serializeTopLevelMaterial(material: MaterialDefinition, losses: ConversionLossItem[]): string[] {
    if (!material.name) {
        return [];
    }

    const lines = [`<material name="${escapeXmlAttr(material.name)}">`];

    if (material.baseColor) {
        lines.push(indent(1, `<color rgba="${formatRGBA(material.baseColor)}" />`));
    }
    if (material.texture?.uri) {
        lines.push(indent(1, `<texture filename="${escapeXmlAttr(material.texture.uri)}" />`));
    }
    if (material.specular !== undefined || material.roughness !== undefined || material.metallic !== undefined) {
        losses.push({
            layer: 'materials',
            entityName: material.name,
            field: 'material.pbr',
            reason: 'URDF only preserves color/texture. PBR material fields were omitted.'
        });
    }

    lines.push('</material>');
    return lines;
}

function serializeInertial(
    physics: RobotIRDocument['physics']['links'][number],
    _losses: ConversionLossItem[]
): string[] {
    const lines = ['<inertial>'];
    lines.push(indent(1, `<origin ${serializeOriginAttributes(physics.inertialOrigin)} />`));
    if (physics.mass !== undefined && physics.mass !== null) {
        lines.push(indent(1, `<mass value="${formatNumber(physics.mass)}" />`));
    }
    if (physics.inertia) {
        lines.push(indent(1, `<inertia ${serializeInertia(physics.inertia)} />`));
    }
    lines.push('</inertial>');
    return lines;
}

function serializeGeometryElement(
    element: GeometryElement,
    tagName: 'visual' | 'collision',
    materialMap: Map<string, MaterialDefinition>,
    losses: ConversionLossItem[],
    meshExportPaths: Map<string, string>
): string[] {
    const lines = [`<${tagName}${element.name ? ` name="${escapeXmlAttr(element.name)}"` : ''}>`];
    lines.push(indent(1, `<origin ${serializeOriginAttributes(element.origin)} />`));

    const geometryLines = serializeGeometryDefinition(element, losses, meshExportPaths);
    if (geometryLines.length === 0) {
        return [];
    }
    lines.push(indent(1, '<geometry>'));
    lines.push(...geometryLines.map(line => indent(2, line)));
    lines.push(indent(1, '</geometry>'));

    if (tagName === 'visual' && element.material) {
        const material = materialMap.get(element.material);
        if (material) {
            lines.push(indent(1, `<material name="${escapeXmlAttr(material.name)}" />`));
        } else {
            lines.push(indent(1, `<material name="${escapeXmlAttr(element.material)}" />`));
        }
    }

    lines.push(`</${tagName}>`);
    return lines;
}

function serializeGeometryDefinition(
    element: GeometryElement,
    losses: ConversionLossItem[],
    meshExportPaths: Map<string, string>
): string[] {
    switch (element.geometry.kind) {
        case 'box':
            return [`<box size="${formatVec3(element.geometry.size || { x: 0, y: 0, z: 0 })}" />`];
        case 'sphere':
            return [`<sphere radius="${formatNumber(element.geometry.radius || 0)}" />`];
        case 'cylinder':
            return [`<cylinder radius="${formatNumber(element.geometry.radius || 0)}" length="${formatNumber(element.geometry.height || 0)}" />`];
        case 'capsule':
            losses.push({
                layer: 'geometry',
                entityName: element.name,
                field: 'geometry.capsule',
                reason: 'URDF has no capsule primitive. Exported as cylinder with the same radius and length.'
            });
            return [`<cylinder radius="${formatNumber(element.geometry.radius || 0)}" length="${formatNumber(element.geometry.height || element.geometry.length || 0)}" />`];
        case 'plane':
            losses.push({
                layer: 'geometry',
                entityName: element.name,
                field: 'geometry.plane',
                reason: 'URDF has no plane primitive. Exported as a thin box.'
            });
            return [`<box size="${formatVec3(element.geometry.size || { x: 1, y: 1, z: 0.01 })}" />`];
        case 'mesh': {
            const fileName = getMeshExportPath(element.geometry, meshExportPaths);
            const attrs = [`filename="${escapeXmlAttr(fileName)}"`];
            if (element.geometry.scale) {
                attrs.push(`scale="${formatVec3(element.geometry.scale)}"`);
            }
            return [`<mesh ${attrs.join(' ')} />`];
        }
        case 'point-cloud':
            losses.push({
                layer: 'geometry',
                entityName: element.name,
                field: 'geometry.point-cloud',
                reason: 'URDF cannot encode point-cloud geometry. The element was skipped.'
            });
            return [];
    }
}

function collectMeshArtifacts(document: RobotIRDocument, meshExportPaths: Map<string, string>): GeneratedArtifact[] {
    const seen = new Set<string>();
    const artifacts: GeneratedArtifact[] = [];

    [...document.geometry.visuals, ...document.geometry.collisions].forEach(element => {
        if (element.geometry.kind !== 'mesh') {
            return;
        }

        const fileName = getMeshExportPath(element.geometry, meshExportPaths);
        const sourcePath = getMeshSourcePath(element.geometry);
        if (!fileName || !sourcePath) {
            return;
        }

        const key = `${fileName}::${sourcePath}`;
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        artifacts.push({
            fileName,
            mimeType: inferMimeType(fileName),
            sourcePath
        });
    });

    return artifacts;
}

function collectMeshExportPaths(document: RobotIRDocument): Map<string, string> {
    const meshExportPaths = new Map<string, string>();
    const usedPaths = new Set<string>();

    [...document.geometry.visuals, ...document.geometry.collisions].forEach(element => {
        if (element.geometry.kind !== 'mesh') {
            return;
        }

        const sourceKey = getMeshSourcePath(element.geometry);
        if (!sourceKey || meshExportPaths.has(sourceKey)) {
            return;
        }

        const exportPath = createUniqueMeshExportPath(sourceKey, usedPaths);
        meshExportPaths.set(sourceKey, exportPath);
        usedPaths.add(exportPath);
    });

    return meshExportPaths;
}

function getMeshExportPath(geometry: MeshGeometry, meshExportPaths: Map<string, string>): string {
    const sourceKey = getMeshSourcePath(geometry);
    return meshExportPaths.get(sourceKey) || createUniqueMeshExportPath(sourceKey, new Set<string>());
}

function getMeshSourcePath(geometry: MeshGeometry): string {
    return normalizeAssetPath(geometry.resolvedUri || stripPackageScheme(geometry.packageUri || '') || geometry.uri || '');
}

function createUniqueMeshExportPath(sourcePath: string, usedPaths: Set<string>): string {
    const normalizedSource = normalizeAssetPath(sourcePath);
    const fileName = normalizedSource.split('/').pop() || 'mesh.bin';
    const extIndex = fileName.lastIndexOf('.');
    const hasExt = extIndex > 0;
    const baseName = hasExt ? fileName.slice(0, extIndex) : fileName;
    const ext = hasExt ? fileName.slice(extIndex) : '';

    let candidate = `mesh/${fileName}`;
    let index = 1;
    while (usedPaths.has(candidate)) {
        candidate = `mesh/${baseName}_${index}${ext}`;
        index += 1;
    }
    return candidate;
}

function stripPackageScheme(uri: string): string {
    return uri.replace(/^package:\/\//, '');
}

function normalizeAssetPath(path: string): string {
    return path.replace(/^\/+/, '').replace(/\\/g, '/');
}

function serializeJoint(
    joint: JointNode,
    mimic: { joint: string; multiplier: number; offset: number; } | undefined,
    losses: ConversionLossItem[]
): string[] {
    const type = mapURDFJointType(joint, losses);
    if (!type) {
        return [];
    }

    const lines = [`<joint name="${escapeXmlAttr(joint.name)}" type="${type}">`];
    lines.push(indent(1, `<parent link="${escapeXmlAttr(joint.parentLink)}" />`));
    lines.push(indent(1, `<child link="${escapeXmlAttr(joint.childLink)}" />`));
    lines.push(indent(1, `<origin ${serializeOriginAttributes(joint.origin)} />`));

    if (joint.axis && ['revolute', 'continuous', 'prismatic', 'planar'].includes(type)) {
        lines.push(indent(1, `<axis xyz="${formatVec3(joint.axis)}" />`));
    }

    if (['revolute', 'prismatic'].includes(type)) {
        if (joint.limits) {
            const limitAttributes = [
                `lower="${formatNumber(joint.limits.lower || 0)}"`,
                `upper="${formatNumber(joint.limits.upper || 0)}"`
            ];
            if (joint.limits.effort !== undefined && joint.limits.effort !== null) {
                limitAttributes.push(`effort="${formatNumber(joint.limits.effort)}"`);
            }
            if (joint.limits.velocity !== undefined && joint.limits.velocity !== null) {
                limitAttributes.push(`velocity="${formatNumber(joint.limits.velocity)}"`);
            }
            lines.push(indent(1, `<limit ${limitAttributes.join(' ')} />`));
        } else {
            losses.push({
                layer: 'structure',
                entityName: joint.name,
                field: 'joint.limit',
                reason: `URDF ${type} joint is missing limit data.`
            });
        }
    }

    if (joint.dynamics && hasJointDynamics(joint.dynamics)) {
        const dynamicsAttributes: string[] = [];
        if (joint.dynamics.damping !== undefined && joint.dynamics.damping !== null) {
            dynamicsAttributes.push(`damping="${formatNumber(joint.dynamics.damping)}"`);
        }
        if (joint.dynamics.friction !== undefined && joint.dynamics.friction !== null) {
            dynamicsAttributes.push(`friction="${formatNumber(joint.dynamics.friction)}"`);
        }
        if (dynamicsAttributes.length > 0) {
            lines.push(indent(1, `<dynamics ${dynamicsAttributes.join(' ')} />`));
        }
    }

    if (mimic) {
        lines.push(indent(1, `<mimic joint="${escapeXmlAttr(mimic.joint)}" multiplier="${formatNumber(mimic.multiplier)}" offset="${formatNumber(mimic.offset)}" />`));
    }

    lines.push('</joint>');
    return lines;
}

function mapURDFJointType(joint: JointNode, losses: ConversionLossItem[]): string | null {
    switch (joint.type) {
        case 'fixed':
        case 'revolute':
        case 'continuous':
        case 'prismatic':
        case 'floating':
        case 'planar':
            return joint.type;
        case 'ball':
            losses.push({
                layer: 'structure',
                entityName: joint.name,
                field: 'joint.type',
                reason: 'URDF has no ball joint. Exported as fixed.'
            });
            return 'fixed';
        default:
            losses.push({
                layer: 'structure',
                entityName: joint.name,
                field: 'joint.type',
                reason: `Unsupported joint type "${joint.type}" was exported as fixed.`
            });
            return 'fixed';
    }
}

function collectMimicMap(
    document: RobotIRDocument,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): Map<string, { joint: string; multiplier: number; offset: number; }> {
    const mimicMap = new Map<string, { joint: string; multiplier: number; offset: number; }>();
    const equalities = (document.semantics.robot.mjcf?.equality || []) as MJCFEqualitySemantic[];

    equalities.forEach(item => {
        if (item.type && item.type !== 'joint') {
            return;
        }
        if (!item.joint1 || !item.joint2) {
            return;
        }

        const polycoef = item.polycoef || [0, 1];
        if ((polycoef[2] || 0) !== 0 || (polycoef[3] || 0) !== 0 || (polycoef[4] || 0) !== 0) {
            losses.push({
                layer: 'semantics',
                entityName: item.name,
                field: 'equality.polycoef',
                reason: 'Only linear MJCF joint equality can be exported to URDF mimic.'
            });
            return;
        }

        mimicMap.set(item.joint1, {
            joint: item.joint2,
            offset: polycoef[0] || 0,
            multiplier: polycoef[1] ?? 1
        });
    });

    if (mimicMap.size > 0) {
        messages.push({
            code: 'urdf_mimic_exported',
            level: 'info',
            message: `Exported ${mimicMap.size} MJCF equality constraint(s) as URDF mimic.`,
            layer: 'semantics'
        });
    }

    return mimicMap;
}

function collectTransmissions(
    document: RobotIRDocument,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): string[][] {
    const actuators = (document.semantics.robot.mjcf?.actuators || []) as MJCFActuatorSemantic[];
    const transmissions = actuators
        .filter(item => item.joint)
        .map(item => {
            const transmissionName = item.name ? `${item.name}_transmission` : `${item.joint}_transmission`;
            const actuatorName = item.name || `${item.joint}_motor`;
            const reduction = Array.isArray(item.gear) ? item.gear[0] : (item.gear ?? 1);
            const hardwareInterface = mapMJCFActuatorToHardwareInterface(item.type);
            return [
                `<transmission name="${escapeXmlAttr(transmissionName)}">`,
                indent(1, '<type>transmission_interface/SimpleTransmission</type>'),
                indent(1, `<joint name="${escapeXmlAttr(item.joint || '')}">`),
                indent(2, `<hardwareInterface>${escapeXmlText(hardwareInterface)}</hardwareInterface>`),
                indent(1, '</joint>'),
                indent(1, `<actuator name="${escapeXmlAttr(actuatorName)}">`),
                indent(2, `<hardwareInterface>${escapeXmlText(hardwareInterface)}</hardwareInterface>`),
                indent(2, `<mechanicalReduction>${formatNumber(reduction)}</mechanicalReduction>`),
                indent(1, '</actuator>'),
                '</transmission>'
            ];
        });

    if (transmissions.length > 0) {
        messages.push({
            code: 'urdf_transmission_exported',
            level: 'info',
            message: `Exported ${transmissions.length} MJCF actuator(s) as URDF transmission tags.`,
            layer: 'semantics'
        });
    }

    const unsupported = actuators.filter(item => !item.joint);
    unsupported.forEach(item => {
        losses.push({
            layer: 'semantics',
            entityName: item.name,
            field: 'actuator.joint',
            reason: `MJCF actuator type "${item.type || 'unknown'}" does not target a joint and cannot be represented in URDF transmission tags.`
        });
    });

    actuators
        .filter(item => item.joint && (item.attributes?.ctrlrange || item.attributes?.forcerange || item.attributes?.gainprm || item.attributes?.biasprm))
        .forEach(item => {
            losses.push({
                layer: 'semantics',
                entityName: item.name,
                field: 'actuator.parameters',
                reason: `MJCF actuator "${item.name || item.joint}" has control or gain parameters that URDF transmission tags cannot represent.`
            });
        });

    return transmissions;
}

function mapMJCFActuatorToHardwareInterface(type?: string): string {
    switch (type) {
        case 'position':
            return 'hardware_interface/PositionJointInterface';
        case 'velocity':
            return 'hardware_interface/VelocityJointInterface';
        case 'intvelocity':
            return 'hardware_interface/VelocityJointInterface';
        default:
            return 'hardware_interface/EffortJointInterface';
    }
}

function hasJointDynamics(dynamics: JointNode['dynamics']): boolean {
    return Boolean(
        dynamics &&
        (dynamics.damping !== undefined ||
            dynamics.friction !== undefined ||
            dynamics.stiffness !== undefined ||
            dynamics.armature !== undefined)
    );
}

function serializeOriginAttributes(transform?: Transform | null): string {
    const translation = transform?.translation || { x: 0, y: 0, z: 0 };
    const rotation = transform?.rotationRPY || (transform?.rotationQuat ? quaternionToRPY(transform.rotationQuat) : { x: 0, y: 0, z: 0 });
    return `xyz="${formatVec3(translation)}" rpy="${formatVec3(rotation)}"`;
}

function serializeInertia(inertia: NonNullable<RobotIRDocument['physics']['links'][number]['inertia']>): string {
    return [
        `ixx="${formatNumber(inertia.ixx)}"`,
        `iyy="${formatNumber(inertia.iyy)}"`,
        `izz="${formatNumber(inertia.izz)}"`,
        `ixy="${formatNumber(inertia.ixy || 0)}"`,
        `ixz="${formatNumber(inertia.ixz || 0)}"`,
        `iyz="${formatNumber(inertia.iyz || 0)}"`
    ].join(' ');
}

function quaternionToRPY(quat: Vec4): Vec3 {
    const { x, y, z, w } = quat;
    const sinrCosp = 2 * (w * x + y * z);
    const cosrCosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinrCosp, cosrCosp);

    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

    const sinyCosp = 2 * (w * z + x * y);
    const cosyCosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(sinyCosp, cosyCosp);

    return { x: roll, y: pitch, z: yaw };
}

function formatVec3(vector: Vec3): string {
    return `${formatNumber(vector.x)} ${formatNumber(vector.y)} ${formatNumber(vector.z)}`;
}

function formatRGBA(color: Vec4): string {
    return `${formatNumber(color.x)} ${formatNumber(color.y)} ${formatNumber(color.z)} ${formatNumber(color.w)}`;
}

function inferMimeType(fileName: string): string {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.stl')) return 'model/stl';
    if (lower.endsWith('.dae')) return 'model/vnd.collada+xml';
    if (lower.endsWith('.obj')) return 'text/plain';
    if (lower.endsWith('.glb')) return 'model/gltf-binary';
    if (lower.endsWith('.gltf')) return 'model/gltf+json';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return Number(value.toFixed(6)).toString();
}

function escapeXmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function indent(depth: number, line: string): string {
    return `${'    '.repeat(depth)}${line}`;
}
