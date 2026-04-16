import type {
    ConversionLossItem,
    ConversionMessage,
    FormatSerializer,
    GeneratedArtifact,
    GeometryElement,
    JointNode,
    MaterialDefinition,
    RobotIRDocument,
    SerializeContext,
    SerializeResult,
    SerializeTarget,
    Transform,
    XMLNodeSnapshot
} from '../converter.js';

type AssetMeshInfo = {
    key: string;
    name: string;
    file: string;
    sourcePath: string;
    scale?: string;
};

type PreservedMJCFActuator = {
    type?: string;
    name?: string;
    joint?: string;
    attributes?: Record<string, unknown>;
    children?: XMLNodeSnapshot[];
};

type PreservedMJCFEquality = {
    type?: string;
    name?: string;
    joint1?: string;
    joint2?: string;
    polycoef?: number[];
};

export class MJCFSerializer implements FormatSerializer {
    async serialize(document: RobotIRDocument, _target: SerializeTarget, _context: SerializeContext = {}): Promise<SerializeResult> {
        const messages: ConversionMessage[] = [];
        const losses: ConversionLossItem[] = [];
        const artifacts: GeneratedArtifact[] = [];
        const lines: string[] = [];

        const rootLink = resolveRootLink(document, messages);
        if (!rootLink) {
            throw new Error('MJCF serialization failed: no root link found');
        }

        const linkNames = new Set(document.structure.links.map(link => link.name));
        const childJointsByParent = new Map<string, JointNode[]>();

        document.structure.joints.forEach(joint => {
            if (!childJointsByParent.has(joint.parentLink)) {
                childJointsByParent.set(joint.parentLink, []);
            }
            childJointsByParent.get(joint.parentLink)?.push(joint);

            if (!linkNames.has(joint.parentLink) || !linkNames.has(joint.childLink)) {
                losses.push({
                    layer: 'structure',
                    entityName: joint.name,
                    field: 'parentLink/childLink',
                    reason: 'Joint references missing links and may not serialize correctly'
                });
            }
        });

        if (document.structure.constraints.length > 0) {
            losses.push({
                layer: 'semantics',
                field: 'constraints',
                reason: 'Robot IR constraints are not yet serialized to MJCF equality constraints'
            });
        }

        const assetMeshes = collectMeshAssets(document);
        const assetMaterials = collectMaterialAssets(document, messages, losses);
        artifacts.push(...assetMeshes.map(mesh => ({
            fileName: mesh.file,
            mimeType: inferMimeType(mesh.file),
            sourcePath: mesh.sourcePath
        })));
        const equalityJointLines = collectEqualityLines(document, messages, losses);
        const actuatorLines = collectActuators(document, messages, losses);
        const linkPhysicsMap = new Map(document.physics.links.map(item => [item.link, item]));
        const visualsByLink = groupByLink(document.geometry.visuals);
        const collisionsByLink = groupByLink(document.geometry.collisions);

        lines.push(`<mujoco model="${escapeXmlAttr(document.metadata.name || 'robot')}">`);
        lines.push(indent(1, serializeCompiler(document)));
        lines.push(...serializeDefaultBlocks(document).map(line => indent(1, line)));

        if (assetMeshes.length > 0 || assetMaterials.length > 0) {
            lines.push(indent(1, '<asset>'));

            assetMeshes.forEach(mesh => {
                const attrs = [
                    `name="${escapeXmlAttr(mesh.name)}"`,
                    `file="${escapeXmlAttr(mesh.file)}"`
                ];
                if (mesh.scale) {
                    attrs.push(`scale="${mesh.scale}"`);
                }
                lines.push(indent(2, `<mesh ${attrs.join(' ')} />`));
            });

            assetMaterials.forEach(material => {
                const attrs = [`name="${escapeXmlAttr(material.name)}"`];
                if (material.baseColor) {
                    attrs.push(`rgba="${formatRGBA(material.baseColor)}"`);
                }
                if (material.specular !== undefined && material.specular !== null) {
                    attrs.push(`specular="${formatNumber(material.specular)}"`);
                }
                if (material.roughness !== undefined && material.roughness !== null) {
                    attrs.push(`shininess="${formatNumber(Math.max(0, 1 - material.roughness))}"`);
                }
                lines.push(indent(2, `<material ${attrs.join(' ')} />`));
            });

            lines.push(indent(1, '</asset>'));
        }

        lines.push(indent(1, '<worldbody>'));
        lines.push(...serializeLinkBody({
            linkName: rootLink,
            parentJoint: null,
            childJointsByParent,
            linkPhysicsMap,
            visualsByLink,
            collisionsByLink,
            assetMeshes,
            assetMaterials,
            messages,
            losses,
            depth: 2
        }));
        lines.push(indent(1, '</worldbody>'));

        if (equalityJointLines.length > 0) {
            lines.push(indent(1, '<equality>'));
            equalityJointLines.forEach(line => lines.push(indent(2, line)));
            lines.push(indent(1, '</equality>'));
        }

        if (actuatorLines.length > 0) {
            lines.push(indent(1, '<actuator>'));
            actuatorLines.forEach(line => lines.push(indent(2, line)));
            lines.push(indent(1, '</actuator>'));
        }

        lines.push('</mujoco>');

        return {
            format: 'mjcf',
            content: lines.join('\n'),
            mimeType: 'application/xml',
            messages,
            losses,
            artifacts
        };
    }
}

function resolveRootLink(document: RobotIRDocument, messages: ConversionMessage[]): string | null {
    if (document.structure.rootLink) {
        return document.structure.rootLink;
    }

    const childLinks = new Set(document.structure.joints.map(joint => joint.childLink));
    const candidate = document.structure.links.find(link => !childLinks.has(link.name))?.name || document.structure.links[0]?.name || null;
    if (candidate) {
        messages.push({
            code: 'mjcf_root_inferred',
            level: 'warning',
            message: `Root link was missing in Robot IR. Inferred root link "${candidate}".`,
            layer: 'structure',
            entityName: candidate
        });
    }
    return candidate;
}

function collectMeshAssets(document: RobotIRDocument): AssetMeshInfo[] {
    const assets: AssetMeshInfo[] = [];
    const seen = new Map<string, string>();

    [...document.geometry.visuals, ...document.geometry.collisions].forEach(element => {
        if (element.geometry.kind !== 'mesh') {
            return;
        }

        const key = element.geometry.resolvedUri || element.geometry.uri;
        if (!key || seen.has(key)) {
            return;
        }

        const assetName = createUniqueAssetName(key, new Set(seen.values()));
        seen.set(key, assetName);
        assets.push({
            key,
            name: assetName,
            sourcePath: normalizeAssetFile(key),
            file: createExportAssetFileName(assetName, key),
            scale: element.geometry.scale ? formatVec3(element.geometry.scale) : undefined
        });
    });

    return assets;
}

function collectMaterialAssets(
    document: RobotIRDocument,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): MaterialDefinition[] {
    const materials = document.materials.materials.filter(material => Boolean(material.name));

    materials.forEach(material => {
        if (material.texture) {
            losses.push({
                layer: 'materials',
                entityName: material.name,
                field: 'texture',
                reason: 'Texture export to MJCF asset/textures is not implemented yet'
            });
        }
        if (material.normalTexture) {
            losses.push({
                layer: 'materials',
                entityName: material.name,
                field: 'normalTexture',
                reason: 'Normal texture export to MJCF is not implemented yet'
            });
        }
        if (material.emissiveColor) {
            messages.push({
                code: 'mjcf_material_emissive_ignored',
                level: 'warning',
                message: `Material "${material.name}" has emissiveColor, which is ignored in current MJCF serializer.`,
                layer: 'materials',
                entityName: material.name
            });
        }
    });

    return materials;
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

function serializeLinkBody(params: {
    linkName: string;
    parentJoint: JointNode | null;
    childJointsByParent: Map<string, JointNode[]>;
    linkPhysicsMap: Map<string, RobotIRDocument['physics']['links'][number]>;
    visualsByLink: Map<string, GeometryElement[]>;
    collisionsByLink: Map<string, GeometryElement[]>;
    assetMeshes: AssetMeshInfo[];
    assetMaterials: MaterialDefinition[];
    messages: ConversionMessage[];
    losses: ConversionLossItem[];
    depth: number;
}): string[] {
    const {
        linkName,
        parentJoint,
        childJointsByParent,
        linkPhysicsMap,
        visualsByLink,
        collisionsByLink,
        assetMeshes,
        assetMaterials,
        messages,
        losses,
        depth
    } = params;

    const lines: string[] = [];
    const bodyAttrs = [`name="${escapeXmlAttr(linkName)}"`];
    if (parentJoint) {
        appendTransformAttributes(bodyAttrs, parentJoint.origin);
    }
    lines.push(indent(depth, `<body ${bodyAttrs.join(' ')}>`));

    if (parentJoint) {
        const serializedJoint = serializeJoint(parentJoint, messages, losses, depth + 1);
        lines.push(...serializedJoint);
    }

        const physics = linkPhysicsMap.get(linkName);
    if (physics) {
        const attrs: string[] = [];
        if (physics.inertialOrigin) {
            appendTransformAttributes(attrs, physics.inertialOrigin);
        }
        if (physics.mass !== undefined && physics.mass !== null) {
            attrs.push(`mass="${formatNumber(physics.mass)}"`);
        }
        if (physics.inertia) {
            attrs.push(`fullinertia="${formatFullInertia(physics.inertia)}"`);
        }
        if (attrs.length > 0) {
            lines.push(indent(depth + 1, `<inertial ${attrs.join(' ')} />`));
        }
    }

    visualsByLink.get(linkName)?.forEach((geom, index) => {
        lines.push(indent(depth + 1, serializeGeom(geom, index, 'visual', assetMeshes, assetMaterials, losses)));
    });

    collisionsByLink.get(linkName)?.forEach((geom, index) => {
        lines.push(indent(depth + 1, serializeGeom(geom, index, 'collision', assetMeshes, assetMaterials, losses)));
    });

    const childJoints = childJointsByParent.get(linkName) || [];
    childJoints.forEach(childJoint => {
        lines.push(...serializeLinkBody({
            ...params,
            linkName: childJoint.childLink,
            parentJoint: childJoint,
            depth: depth + 1
        }));
    });

    lines.push(indent(depth, '</body>'));
    return lines;
}

function collectMimicEqualities(
    document: RobotIRDocument,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): string[] {
    const lines: string[] = [];
    const jointNames = new Set(document.structure.joints.map(joint => joint.name));

    document.structure.joints.forEach(joint => {
        const mimic = document.semantics.joints[joint.name]?.urdf?.mimic;
        if (!mimic?.attributes) {
            return;
        }

        const sourceJoint = String(mimic.attributes.joint || '');
        if (!sourceJoint) {
            losses.push({
                layer: 'semantics',
                entityName: joint.name,
                field: 'mimic.joint',
                reason: 'URDF mimic tag is missing source joint reference'
            });
            return;
        }

        if (!jointNames.has(sourceJoint)) {
            losses.push({
                layer: 'semantics',
                entityName: joint.name,
                field: 'mimic.joint',
                reason: `Referenced mimic source joint "${sourceJoint}" is not present in Robot IR`
            });
            return;
        }

        const multiplier = parseMaybeNumber(mimic.attributes.multiplier, 1);
        const offset = parseMaybeNumber(mimic.attributes.offset, 0);
        lines.push(
            `<joint name="${escapeXmlAttr(`${joint.name}_mimic`)}" joint1="${escapeXmlAttr(joint.name)}" joint2="${escapeXmlAttr(sourceJoint)}" polycoef="${formatNumber(offset)} ${formatNumber(multiplier)} 0 0 0" />`
        );
        messages.push({
            code: 'mjcf_mimic_exported',
            level: 'info',
            message: `Joint "${joint.name}" mimic was exported as MJCF equality/joint.`,
            layer: 'semantics',
            entityName: joint.name
        });

        if (document.semantics.joints[joint.name]?.urdf?.safetyController) {
            losses.push({
                layer: 'semantics',
                entityName: joint.name,
                field: 'safety_controller',
                reason: 'URDF safety_controller is not yet serialized to MJCF'
            });
        }
        if (document.semantics.joints[joint.name]?.urdf?.calibration) {
            losses.push({
                layer: 'semantics',
                entityName: joint.name,
                field: 'calibration',
                reason: 'URDF calibration is not yet serialized to MJCF'
            });
        }
    });

    return lines;
}

function collectPreservedEqualities(
    document: RobotIRDocument,
    messages: ConversionMessage[]
): string[] {
    const equalities = (document.semantics.robot.mjcf?.equality || []) as PreservedMJCFEquality[];
    const lines: string[] = [];

    equalities.forEach(item => {
        if (item.type && item.type !== 'joint') {
            return;
        }
        if (!item.joint1 || !item.joint2) {
            return;
        }

        const attrs = [
            `joint1="${escapeXmlAttr(item.joint1)}"`,
            `joint2="${escapeXmlAttr(item.joint2)}"`,
            `polycoef="${(item.polycoef && item.polycoef.length > 0 ? item.polycoef : [0, 1]).map(value => formatNumber(value)).join(' ')}"`
        ];
        if (item.name) {
            attrs.unshift(`name="${escapeXmlAttr(item.name)}"`);
        }
        lines.push(`<joint ${attrs.join(' ')} />`);
    });

    if (lines.length > 0) {
        messages.push({
            code: 'mjcf_preserved_equalities_exported',
            level: 'info',
            message: `Reused ${lines.length} preserved MJCF equality constraint(s).`,
            layer: 'semantics'
        });
    }

    return lines;
}

function collectEqualityLines(
    document: RobotIRDocument,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): string[] {
    const preserved = collectPreservedEqualities(document, messages);
    if (preserved.length > 0) {
        return preserved;
    }

    return collectMimicEqualities(document, messages, losses);
}

function collectActuators(
    document: RobotIRDocument,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): string[] {
    const preservedActuators = collectPreservedActuators(document, messages);
    if (preservedActuators.length > 0) {
        return preservedActuators;
    }

    const transmissionLines = collectTransmissionActuators(document, losses);
    if (transmissionLines.length > 0) {
        messages.push({
            code: 'mjcf_actuators_from_transmission',
            level: 'info',
            message: `Exported ${transmissionLines.length} actuator(s) from URDF transmission tags.`,
            layer: 'semantics'
        });
        return transmissionLines;
    }

    const autoActuators = document.structure.joints
        .filter(joint => ['revolute', 'continuous', 'prismatic'].includes(joint.type))
        .map(joint => {
            const attrs = [
                `name="${escapeXmlAttr(`${joint.name}_motor`)}"`,
                `joint="${escapeXmlAttr(joint.name)}"`
            ];

            const effort = joint.limits?.effort;
            if (effort !== undefined && effort !== null) {
                attrs.push(`forcerange="${formatNumber(-Math.abs(effort))} ${formatNumber(Math.abs(effort))}"`);
            }

            return `<motor ${attrs.join(' ')} />`;
        });

    if (autoActuators.length > 0) {
        messages.push({
            code: 'mjcf_actuators_auto_generated',
            level: 'info',
            message: `No URDF transmission tags found. Auto-generated ${autoActuators.length} motor actuator(s).`,
            layer: 'semantics'
        });
    } else {
        losses.push({
            layer: 'semantics',
            field: 'actuator',
            reason: 'No actuated revolute/prismatic joints were found for MJCF actuator export'
        });
    }

    return autoActuators;
}

function collectTransmissionActuators(
    document: RobotIRDocument,
    losses: ConversionLossItem[]
): string[] {
    const transmissions = document.semantics.robot.urdf?.transmissions || [];
    const actuatorLines: string[] = [];
    const seen = new Set<string>();

    transmissions.forEach((transmission, index) => {
        const jointNode = findSnapshotChild(transmission, 'joint');
        if (!jointNode?.attributes?.name) {
            losses.push({
                layer: 'semantics',
                field: `transmission[${index}].joint`,
                reason: 'Transmission has no joint name and was skipped'
            });
            return;
        }

        const jointName = String(jointNode.attributes.name);
        if (seen.has(jointName)) {
            return;
        }
        seen.add(jointName);

        const actuatorNode = findSnapshotChild(transmission, 'actuator');
        const actuatorName = String(actuatorNode?.attributes?.name || `${jointName}_motor`);
        const mechanicalReduction = parseMaybeNumber(findSnapshotText(actuatorNode, 'mechanicalReduction'), 1);
        const interfaceHint = [
            findSnapshotText(actuatorNode, 'hardwareInterface'),
            findSnapshotText(jointNode, 'hardwareInterface')
        ].find(Boolean);
        const actuatorTag = mapHardwareInterfaceToMJCFActuator(interfaceHint);
        const attrs = [
            `name="${escapeXmlAttr(actuatorName)}"`,
            `joint="${escapeXmlAttr(jointName)}"`,
            `gear="${formatNumber(mechanicalReduction)}"`
        ];
        const jointDefinition = document.structure.joints.find(item => item.name === jointName);
        if (jointDefinition?.limits?.effort !== undefined && jointDefinition.limits.effort !== null) {
            attrs.push(`forcerange="${formatNumber(-Math.abs(jointDefinition.limits.effort))} ${formatNumber(Math.abs(jointDefinition.limits.effort))}"`);
        }
        if (actuatorTag === 'position' && jointDefinition?.limits) {
            const hasLower = jointDefinition.limits.lower !== undefined && jointDefinition.limits.lower !== null;
            const hasUpper = jointDefinition.limits.upper !== undefined && jointDefinition.limits.upper !== null;
            if (hasLower && hasUpper) {
                attrs.push(`ctrlrange="${formatNumber(jointDefinition.limits.lower || 0)} ${formatNumber(jointDefinition.limits.upper || 0)}"`);
                attrs.push('ctrllimited="true"');
            }
        }
        if (actuatorTag === 'velocity' && jointDefinition?.limits?.velocity !== undefined && jointDefinition.limits.velocity !== null) {
            const velocity = Math.abs(jointDefinition.limits.velocity);
            attrs.push(`ctrlrange="${formatNumber(-velocity)} ${formatNumber(velocity)}"`);
            attrs.push('ctrllimited="true"');
        }

        actuatorLines.push(`<${actuatorTag} ${attrs.join(' ')} />`);
    });

    return actuatorLines;
}

function collectPreservedActuators(
    document: RobotIRDocument,
    messages: ConversionMessage[]
): string[] {
    const actuators = (document.semantics.robot.mjcf?.actuators || []) as PreservedMJCFActuator[];
    const lines = actuators
        .map(actuator => serializePreservedActuator(actuator))
        .filter((line): line is string => Boolean(line));

    if (lines.length > 0) {
        messages.push({
            code: 'mjcf_preserved_actuators_exported',
            level: 'info',
            message: `Reused ${lines.length} preserved MJCF actuator(s).`,
            layer: 'semantics'
        });
    }

    return lines;
}

function findSnapshotChild(node: XMLNodeSnapshot | undefined, tagName: string): XMLNodeSnapshot | undefined {
    return node?.children?.find(child => child.tag === tagName);
}

function findSnapshotText(node: XMLNodeSnapshot | undefined, tagName: string): string | undefined {
    return findSnapshotChild(node, tagName)?.textContent;
}

function parseMaybeNumber(value: unknown, fallback: number): number {
    const parsed = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function mapHardwareInterfaceToMJCFActuator(interfaceHint?: string): 'motor' | 'position' | 'velocity' {
    const normalized = String(interfaceHint || '').toLowerCase();
    if (normalized.includes('position')) {
        return 'position';
    }
    if (normalized.includes('velocity')) {
        return 'velocity';
    }
    return 'motor';
}

function serializeJoint(
    joint: JointNode,
    messages: ConversionMessage[],
    losses: ConversionLossItem[],
    depth: number
): string[] {
    const attrs = [`name="${escapeXmlAttr(joint.name)}"`];
    const mjcfType = mapJointType(joint.type, joint.name, messages, losses);
    if (!mjcfType) {
        return [];
    }

    attrs.push(`type="${mjcfType}"`);

    if (joint.axis && (mjcfType === 'hinge' || mjcfType === 'slide')) {
        attrs.push(`axis="${formatVec3(joint.axis)}"`);
    }

    if (joint.limits && mjcfType !== 'free' && mjcfType !== 'ball') {
        const hasLower = joint.limits.lower !== undefined && joint.limits.lower !== null;
        const hasUpper = joint.limits.upper !== undefined && joint.limits.upper !== null;
        if (hasLower && hasUpper && joint.type !== 'continuous') {
            attrs.push(`range="${formatNumber(joint.limits.lower || 0)} ${formatNumber(joint.limits.upper || 0)}"`);
        }
    }

    if (joint.dynamics?.damping !== undefined && joint.dynamics.damping !== null) {
        attrs.push(`damping="${formatNumber(joint.dynamics.damping)}"`);
    }
    if (joint.dynamics?.friction !== undefined && joint.dynamics.friction !== null) {
        attrs.push(`frictionloss="${formatNumber(joint.dynamics.friction)}"`);
    }

    return [indent(depth, `<joint ${attrs.join(' ')} />`)];
}

function mapJointType(
    type: string,
    entityName: string,
    messages: ConversionMessage[],
    losses: ConversionLossItem[]
): string | null {
    switch (type) {
        case 'fixed':
            return null;
        case 'revolute':
        case 'continuous':
            return 'hinge';
        case 'prismatic':
            return 'slide';
        case 'ball':
            return 'ball';
        case 'floating':
            losses.push({
                layer: 'structure',
                entityName,
                field: 'joint.type',
                reason: 'Floating joint is approximated as MJCF free joint'
            });
            return 'free';
        case 'planar':
            losses.push({
                layer: 'structure',
                entityName,
                field: 'joint.type',
                reason: 'Planar joint is approximated as MJCF free joint'
            });
            return 'free';
        default:
            messages.push({
                code: 'mjcf_joint_type_unknown',
                level: 'warning',
                message: `Joint "${entityName}" has unsupported type "${type}", serialized as fixed.`,
                layer: 'structure',
                entityName
            });
            return null;
    }
}

function serializeGeom(
    geom: GeometryElement,
    index: number,
    mode: 'visual' | 'collision',
    assetMeshes: AssetMeshInfo[],
    assetMaterials: MaterialDefinition[],
    losses: ConversionLossItem[]
): string {
    const attrs = [`name="${escapeXmlAttr(geom.name || `${geom.link}_${mode}_${index}`)}"`];
    appendTransformAttributes(attrs, geom.origin);

    if (mode === 'visual') {
        attrs.push('group="1"');
        attrs.push('contype="0"');
        attrs.push('conaffinity="0"');
        attrs.push('density="0"');
    } else {
        attrs.push('group="3"');
        attrs.push('contype="1"');
        attrs.push('conaffinity="1"');
        attrs.push('rgba="0 1 0 0.15"');
    }

    switch (geom.geometry.kind) {
        case 'box': {
            attrs.push('type="box"');
            const size = geom.geometry.size;
            if (size) {
                attrs.push(`size="${formatNumber(size.x / 2)} ${formatNumber(size.y / 2)} ${formatNumber(size.z / 2)}"`);
            }
            break;
        }
        case 'sphere': {
            attrs.push('type="sphere"');
            attrs.push(`size="${formatNumber(geom.geometry.radius || 0.05)}"`);
            break;
        }
        case 'cylinder': {
            attrs.push('type="cylinder"');
            attrs.push(`size="${formatNumber(geom.geometry.radius || 0.05)} ${formatNumber((geom.geometry.height || 0.1) / 2)}"`);
            break;
        }
        case 'capsule': {
            attrs.push('type="capsule"');
            attrs.push(`size="${formatNumber(geom.geometry.radius || 0.05)} ${formatNumber((geom.geometry.height || geom.geometry.length || 0.1) / 2)}"`);
            break;
        }
        case 'plane': {
            attrs.push('type="plane"');
            const size = geom.geometry.size;
            attrs.push(`size="${formatNumber((size?.x || 1) / 2)} ${formatNumber((size?.y || 1) / 2)} ${formatNumber(size?.z || 0.1)}"`);
            break;
        }
        case 'mesh': {
            attrs.push('type="mesh"');
            const meshGeometry = geom.geometry;
            const meshAsset = assetMeshes.find(asset => asset.key === (meshGeometry.resolvedUri || meshGeometry.uri));
            if (meshAsset) {
                attrs.push(`mesh="${escapeXmlAttr(meshAsset.name)}"`);
            } else {
                losses.push({
                    layer: 'geometry',
                    entityName: geom.name,
                    field: 'geometry.mesh',
                    reason: `Mesh asset "${meshGeometry.uri}" was not emitted to MJCF asset section`
                });
            }
            break;
        }
        case 'point-cloud': {
            losses.push({
                layer: 'geometry',
                entityName: geom.name,
                field: 'geometry.point-cloud',
                reason: 'Point cloud geometry is not supported in MJCF serializer'
            });
            attrs.push('type="sphere"');
            attrs.push('size="0.01"');
            break;
        }
    }

    if (mode === 'visual' && geom.material) {
        const material = assetMaterials.find(item => item.name === geom.material);
        if (material) {
            attrs.push(`material="${escapeXmlAttr(material.name)}"`);
        }
    }

    return `<geom ${attrs.join(' ')} />`;
}

function appendTransformAttributes(attrs: string[], transform?: Transform | null): void {
    if (!transform) {
        return;
    }

    if (transform.translation) {
        attrs.push(`pos="${formatVec3(transform.translation)}"`);
    }

    if (transform.rotationQuat) {
        attrs.push(`quat="${formatQuat(transform.rotationQuat)}"`);
    } else if (transform.rotationRPY) {
        attrs.push(`euler="${formatVec3(transform.rotationRPY)}"`);
    }
}

function serializeCompiler(document: RobotIRDocument): string {
    const compilerAttrs = document.semantics.robot.mjcf?.compiler as Record<string, unknown> | undefined;
    const serialized = compilerAttrs ? serializeAttributes(compilerAttrs) : '';
    return serialized ? `<compiler ${serialized} />` : '<compiler angle="radian"/>';
}

function serializeDefaultBlocks(document: RobotIRDocument): string[] {
    const defaults = document.semantics.robot.mjcf?.defaults as { items?: XMLNodeSnapshot[]; } | undefined;
    return defaults?.items?.map(item => serializeSnapshot(item)).filter((line): line is string => Boolean(line)) || [];
}

function serializePreservedActuator(actuator: PreservedMJCFActuator): string | null {
    if (!actuator.type) {
        return null;
    }

    const attrPairs = Object.entries(actuator.attributes || {})
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}="${escapeXmlAttr(String(value))}"`);

    if (!actuator.children || actuator.children.length === 0) {
        return `<${actuator.type}${attrPairs.length > 0 ? ` ${attrPairs.join(' ')}` : ''} />`;
    }

    const childXml = actuator.children.map(child => serializeSnapshot(child)).join('');
    return `<${actuator.type}${attrPairs.length > 0 ? ` ${attrPairs.join(' ')}` : ''}>${childXml}</${actuator.type}>`;
}

function serializeSnapshot(node: XMLNodeSnapshot): string {
    if (node.xml) {
        return node.xml;
    }

    const attrPairs = Object.entries(node.attributes || {})
        .map(([key, value]) => `${key}="${escapeXmlAttr(String(value))}"`);
    const children = node.children?.map(child => serializeSnapshot(child)).join('') || '';
    const text = node.textContent ? escapeXmlText(node.textContent) : '';

    if (!children && !text) {
        return `<${node.tag}${attrPairs.length > 0 ? ` ${attrPairs.join(' ')}` : ''} />`;
    }

    return `<${node.tag}${attrPairs.length > 0 ? ` ${attrPairs.join(' ')}` : ''}>${text}${children}</${node.tag}>`;
}

function serializeAttributes(attributes: Record<string, unknown>): string {
    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}="${escapeXmlAttr(String(value))}"`)
        .join(' ');
}

function formatVec3(vector: { x: number; y: number; z: number; }): string {
    return `${formatNumber(vector.x)} ${formatNumber(vector.y)} ${formatNumber(vector.z)}`;
}

function formatQuat(quat: { x: number; y: number; z: number; w: number; }): string {
    return `${formatNumber(quat.w)} ${formatNumber(quat.x)} ${formatNumber(quat.y)} ${formatNumber(quat.z)}`;
}

function formatRGBA(color: { x: number; y: number; z: number; w: number; }): string {
    return `${formatNumber(color.x)} ${formatNumber(color.y)} ${formatNumber(color.z)} ${formatNumber(color.w)}`;
}

function formatFullInertia(inertia: { ixx: number; iyy: number; izz: number; ixy?: number; ixz?: number; iyz?: number; }): string {
    return [
        formatNumber(inertia.ixx),
        formatNumber(inertia.iyy),
        formatNumber(inertia.izz),
        formatNumber(inertia.ixy || 0),
        formatNumber(inertia.ixz || 0),
        formatNumber(inertia.iyz || 0)
    ].join(' ');
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return Number(value.toFixed(6)).toString();
}

function createUniqueAssetName(source: string, existing: Set<string>): string {
    const basename = source.split('/').pop()?.split('\\').pop()?.replace(/\.[^.]+$/, '') || 'mesh';
    const sanitized = basename.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'mesh';
    if (!existing.has(sanitized)) {
        return sanitized;
    }

    let index = 1;
    while (existing.has(`${sanitized}_${index}`)) {
        index += 1;
    }
    return `${sanitized}_${index}`;
}

function normalizeAssetFile(file: string): string {
    return file.replace(/^\/+/, '').replace(/\\/g, '/');
}

function createExportAssetFileName(assetName: string, sourcePath: string): string {
    const ext = sourcePath.includes('.') ? sourcePath.slice(sourcePath.lastIndexOf('.')) : '';
    return `mesh/${assetName}${ext}`;
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
