import * as THREE from 'three';

type UserDataMap = Record<string, unknown>;
type Vec3 = number[];
type Vec4 = number[];

export interface GeometrySize {
    x?: number;
    y?: number;
    z?: number;
    radius?: number;
    height?: number;
}

export interface GeometryFromTo {
    p1: Vec3;
    p2: Vec3;
    center: Vec3;
    height: number;
    rpy: Vec3;
}

export interface DiagonalInertia {
    ixx: number;
    iyy: number;
    izz: number;
}

/**
 * Unified robot model data interface
 * All formats (URDF, MJCF, USD) are converted to this unified format
 */
export class UnifiedRobotModel {
    name: string = '';
    links: Map<string, Link> = new Map();
    joints: Map<string, Joint> = new Map();
    materials: Map<string, Material> = new Map();
    constraints: Map<string, Constraint> = new Map();
    rootLink: string | null = null;
    threeObject: THREE.Object3D | null = null;
    userData: UserDataMap = {};

    addLink(link: Link): void {
        this.links.set(link.name, link);
    }

    addJoint(joint: Joint): void {
        this.joints.set(joint.name, joint);
    }

    addConstraint(constraint: Constraint): void {
        this.constraints.set(constraint.name, constraint);
    }

    getLink(name: string): Link | undefined {
        return this.links.get(name);
    }

    getJoint(name: string): Joint | undefined {
        return this.joints.get(name);
    }

    getConstraint(name: string): Constraint | undefined {
        return this.constraints.get(name);
    }
}

/**
 * Link interface
 */
export class Link {
    name: string;
    visuals: VisualGeometry[] = [];
    collisions: CollisionGeometry[] = [];
    inertial: InertialProperties | null = null;
    threeObject: THREE.Object3D | null = null;
    userData: UserDataMap = {};

    constructor(name: string = '') {
        this.name = name;
    }
}

/**
 * Origin transformation
 */
export interface Origin {
    xyz: Vec3;
    rpy: Vec3;
    quat?: Vec4;
}

/**
 * VisualGeometry interface
 */
export class VisualGeometry {
    name: string = '';
    origin: Origin = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    geometry: GeometryType | null = null;
    material: Material | null = null;
    threeObject: THREE.Object3D | null = null;
    userData: UserDataMap = {};
}

/**
 * CollisionGeometry interface
 */
export class CollisionGeometry {
    name: string = '';
    origin: Origin = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    geometry: GeometryType | null = null;
    threeObject: THREE.Object3D | null = null;
    userData: UserDataMap = {};
}

/**
 * GeometryType interface
 */
export class GeometryType {
    type: string = '';
    size: GeometrySize | null = null;
    filename: string | null = null;
    meshScale: Vec3 | null = null;
    fromto: GeometryFromTo | null = null;
    inlineVertices: Float32Array | null = null;
    inlineScale: Vec3 | null = null;

    constructor(type: string = '') {
        this.type = type;
    }

    clone(): GeometryType {
        const cloned = new GeometryType(this.type);
        cloned.size = this.size ? { ...this.size } : null;
        cloned.filename = this.filename;
        cloned.meshScale = this.meshScale ? [...this.meshScale] as Vec3 : null;
        cloned.fromto = this.fromto ? {
            p1: [...this.fromto.p1] as Vec3,
            p2: [...this.fromto.p2] as Vec3,
            center: [...this.fromto.center] as Vec3,
            height: this.fromto.height,
            rpy: [...this.fromto.rpy] as Vec3
        } : null;
        cloned.inlineVertices = this.inlineVertices;
        cloned.inlineScale = this.inlineScale ? [...this.inlineScale] as Vec3 : null;
        return cloned;
    }
}

/**
 * InertialProperties interface
 */
export class InertialProperties {
    mass: number = 0;
    origin: Origin = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    ixx: number = 0;
    iyy: number = 0;
    izz: number = 0;
    ixy: number = 0;
    ixz: number = 0;
    iyz: number = 0;
    diagonalInertia: DiagonalInertia | null = null;
}

/**
 * Joint interface
 */
export class Joint {
    name: string;
    type: string = 'fixed';
    parent: string | null = null;
    child: string | null = null;
    origin: Origin = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    axis: { xyz: Vec3 } = { xyz: [0, 0, 1] };
    limits: JointLimits | null = null;
    currentValue: number = 0;
    threeObject: THREE.Object3D | null = null;
    userData: UserDataMap = {};

    constructor(name: string = '', type: string = 'fixed') {
        this.name = name;
        this.type = type;
    }
}

/**
 * JointLimits interface
 */
export class JointLimits {
    lower: number = -Math.PI;
    upper: number = Math.PI;
    effort: number | null = null;
    velocity: number | null = null;
}

/**
 * Material interface
 */
export class Material {
    name: string;
    color: { r: number; g: number; b: number } = { r: 0.8, g: 0.8, b: 0.8 };
    texture: string | null = null;
    rgba: Vec4 | null = null;
    specular: Vec3 | null = null;
    shininess: number | null = null;

    constructor(name: string = '') {
        this.name = name;
    }
}

/**
 * Constraint interface - for describing closed-chain constraints of parallel mechanisms
 * Supports MuJoCo equality constraint types
 */
export class Constraint {
    name: string;
    type: string = 'connect';

    // Constraint objects (may be body, geom, joint, etc. depending on type)
    body1: string | null = null;
    body2: string | null = null;
    anchor: Vec3 | null = null;
    torquescale: number | null = null;

    // Joint constraint specific properties
    joint1: string | null = null;
    joint2: string | null = null;
    polycoef: number[] | null = null;

    // Distance constraint
    distance: number | null = null;

    // Visualization object
    threeObject: THREE.Object3D | null = null;

    // Original data (for debugging)
    userData: UserDataMap = {};

    constructor(name: string = '', type: string = 'connect') {
        this.name = name;
        this.type = type;
    }
}
