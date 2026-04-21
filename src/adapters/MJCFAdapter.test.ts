import { describe, expect, it, vi } from 'vitest';
import { MJCFAdapter } from './MJCFAdapter.js';

function rotateVectorByQuaternion(vector: number[], quat: number[]): number[] {
    const [x, y, z, w] = quat;
    const [vx, vy, vz] = vector;

    const ix = w * vx + y * vz - z * vy;
    const iy = w * vy + z * vx - x * vz;
    const iz = w * vz + x * vy - y * vx;
    const iw = -x * vx - y * vy - z * vz;

    return [
        ix * w + iw * -x + iy * -z - iz * -y,
        iy * w + iw * -y + iz * -x - ix * -z,
        iz * w + iw * -z + ix * -y - iy * -x
    ];
}

describe('MJCFAdapter', () => {
    it('inherits geom mesh definitions from default childclass', () => {
        const xml = `<?xml version="1.0"?>
<mujoco model="default_mesh_inheritance">
  <worldbody>
    <body name="torso" childclass="visual_mesh">
      <geom name="torso_visual" />
    </body>
  </worldbody>
</mujoco>`;

        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const bodyEl = doc.querySelector('body');
        const geomEl = doc.querySelector('geom');
        const classDefaults = new Map([
            ['visual_mesh', {
                geom: {
                    type: 'mesh',
                    mesh: 'torso_mesh',
                    material: 'body_mat',
                    group: 1,
                    contype: 0,
                    conaffinity: 0,
                }
            }]
        ]);
        const rootDefaults = {};
        const meshMap = new Map([
            ['torso_mesh', {
                type: 'file',
                path: 'meshes/torso.stl',
                scale: [1, 2, 3]
            }]
        ]);
        const materialMap = new Map([
            ['body_mat', {
                rgba: {
                    r: 0.2,
                    g: 0.4,
                    b: 0.6,
                    a: 1
                }
            }]
        ]);
        const inheritedProps = MJCFAdapter.getGeomInheritedProperties(
            geomEl,
            classDefaults as any,
            rootDefaults as any,
            bodyEl?.getAttribute('childclass') || null
        );
        const geometry = MJCFAdapter.parseGeom(geomEl, meshMap as any, inheritedProps);

        expect(inheritedProps.mesh).toBe('torso_mesh');
        expect(inheritedProps.material).toBe('body_mat');
        expect(geometry?.type).toBe('mesh');
        expect(geometry?.filename).toBe('meshes/torso.stl');
        expect(geometry?.meshScale).toEqual([1, 2, 3]);

        const material = materialMap.get(inheritedProps.material || '');
        expect(material?.rgba).toEqual({
            r: 0.2,
            g: 0.4,
            b: 0.6,
            a: 1
        });
    });

    it('parses a body geom as mesh when mesh and type come from childclass defaults', async () => {
        const xml = `<?xml version="1.0"?>
<mujoco model="viewer_regression">
  <default class="visual_mesh">
    <geom type="mesh" mesh="torso_mesh" material="body_mat" group="1" contype="0" conaffinity="0" />
  </default>
  <asset>
    <mesh name="torso_mesh" file="meshes/torso.stl" scale="0.001 0.001 0.001" />
    <material name="body_mat" rgba="0.7 0.7 0.7 1" />
  </asset>
  <worldbody>
    <body name="torso" childclass="visual_mesh">
      <geom name="torso_visual" />
    </body>
  </worldbody>
</mujoco>`;

        const createThreeObjectSpy = vi.spyOn(MJCFAdapter, 'createThreeObject').mockResolvedValue(undefined);
        const model = await MJCFAdapter.parse(xml, null, null);
        createThreeObjectSpy.mockRestore();
        const link = model.links.get('torso');

        expect(link).toBeDefined();
        expect(link?.visuals).toHaveLength(1);
        expect(link?.collisions).toHaveLength(0);
        expect(link?.visuals[0].geometry?.type).toBe('mesh');
        expect(link?.visuals[0].geometry?.filename).toBe('meshes/torso.stl');
        expect(link?.visuals[0].geometry?.meshScale).toEqual([0.001, 0.001, 0.001]);
        expect(link?.visuals[0].userData?.meshRef).toBe('torso_mesh');
    });

    it('treats primitive geoms with default rgba as visuals', async () => {
        const xml = `<?xml version="1.0"?>
<mujoco model="ant_like">
  <default>
    <geom contype="0" conaffinity="0" rgba="0.8 0.6 0.4 1" />
  </default>
  <worldbody>
    <body name="torso">
      <geom name="torso_geom" pos="0 0 0" size="0.25" type="sphere" />
      <body name="front_left_leg">
        <geom name="aux_1_geom" size="0.08 0.2" type="capsule" />
      </body>
    </body>
  </worldbody>
</mujoco>`;

        const createThreeObjectSpy = vi.spyOn(MJCFAdapter, 'createThreeObject').mockResolvedValue(undefined);
        const model = await MJCFAdapter.parse(xml, null, null);
        createThreeObjectSpy.mockRestore();

        const torso = model.links.get('torso');
        const leg = model.links.get('front_left_leg');

        expect(torso?.visuals).toHaveLength(1);
        expect(torso?.collisions).toHaveLength(0);
        expect(torso?.visuals[0].geometry?.type).toBe('sphere');
        expect(torso?.visuals[0].userData?.rgba).toEqual({
            r: 0.8,
            g: 0.6,
            b: 0.4,
            a: 1
        });

        expect(leg?.visuals).toHaveLength(1);
        expect(leg?.collisions).toHaveLength(0);
        expect(leg?.visuals[0].geometry?.type).toBe('capsule');
    });

    it('does not pre-rotate fromto primitives before applying explicit fromto rotation', () => {
        const fromtoGeometry = {
            fromto: {
                p1: [0, 0, 0],
                p2: [1, 1, 0],
                center: [0.5, 0.5, 0],
                height: Math.sqrt(2),
                rpy: [0, 0, 0]
            }
        } as any;
        const sizeOnlyGeometry = {
            fromto: null
        } as any;

        expect(MJCFAdapter.shouldRotatePrimitiveToZAxis(fromtoGeometry)).toBe(false);
        expect(MJCFAdapter.shouldRotatePrimitiveToZAxis(sizeOnlyGeometry)).toBe(true);
    });

    it('converts degree-based euler and hinge ranges to radians', async () => {
        const xml = `<?xml version="1.0"?>
<mujoco model="angle_degree">
  <compiler angle="degree" />
  <default class="hinge_defaults">
    <joint type="hinge" range="-90 45" />
  </default>
  <worldbody>
    <body name="base" euler="90 0 0">
      <body name="link1" childclass="hinge_defaults">
        <joint name="hinge1" axis="0 0 1" />
        <geom name="link1_geom" type="sphere" size="0.1" />
      </body>
    </body>
  </worldbody>
</mujoco>`;

        const createThreeObjectSpy = vi.spyOn(MJCFAdapter, 'createThreeObject').mockResolvedValue(undefined);
        const model = await MJCFAdapter.parse(xml, null, null);
        createThreeObjectSpy.mockRestore();

        const base = model.links.get('base');
        const joint = model.joints.get('hinge1');

        expect(base?.userData?.bodyOrigin?.rpy?.[0]).toBeCloseTo(Math.PI / 2);
        expect(joint?.limits?.lower).toBeCloseTo(-Math.PI / 2);
        expect(joint?.limits?.upper).toBeCloseTo(Math.PI / 4);
    });

    it('keeps radian-based euler and hinge ranges unchanged', async () => {
        const xml = `<?xml version="1.0"?>
<mujoco model="angle_radian">
  <compiler angle="radian" />
  <worldbody>
    <body name="base" euler="1.57079632679 0 0">
      <body name="link1">
        <joint name="hinge1" type="hinge" axis="0 0 1" range="-1.57079632679 0.78539816339" />
        <geom name="link1_geom" type="sphere" size="0.1" />
      </body>
    </body>
  </worldbody>
</mujoco>`;

        const createThreeObjectSpy = vi.spyOn(MJCFAdapter, 'createThreeObject').mockResolvedValue(undefined);
        const model = await MJCFAdapter.parse(xml, null, null);
        createThreeObjectSpy.mockRestore();

        const base = model.links.get('base');
        const joint = model.joints.get('hinge1');

        expect(base?.userData?.bodyOrigin?.rpy?.[0]).toBeCloseTo(1.57079632679);
        expect(joint?.limits?.lower).toBeCloseTo(-1.57079632679);
        expect(joint?.limits?.upper).toBeCloseTo(0.78539816339);
    });

    it('inherits geom size and fromto from nested default classes', () => {
        const xml = `<?xml version="1.0"?>
<mujoco model="humanoid_defaults">
  <default>
    <default class="body">
      <geom type="capsule" />
      <default class="hand">
        <geom type="sphere" size=".04" />
      </default>
      <default class="shin">
        <geom fromto="0 0 0 0 0 -.3" size=".049" />
      </default>
    </default>
  </default>
  <worldbody>
    <body name="torso" childclass="body">
      <geom name="hand_geom" class="hand" />
      <geom name="shin_geom" class="shin" />
    </body>
  </worldbody>
</mujoco>`;

        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const { classDefaults, rootDefaults } = MJCFAdapter.parseDefaults(doc);
        const handGeomEl = Array.from(doc.querySelectorAll('geom')).find(item => item.getAttribute('name') === 'hand_geom') || null;
        const shinGeomEl = Array.from(doc.querySelectorAll('geom')).find(item => item.getAttribute('name') === 'shin_geom') || null;
        const handInherited = MJCFAdapter.getGeomInheritedProperties(handGeomEl, classDefaults, rootDefaults, 'body');
        const shinInherited = MJCFAdapter.getGeomInheritedProperties(shinGeomEl, classDefaults, rootDefaults, 'body');
        const handGeometry = MJCFAdapter.parseGeom(handGeomEl, null, handInherited);

        expect(handGeometry?.type).toBe('sphere');
        expect(handGeometry?.size?.radius).toBeCloseTo(0.04);
        expect(shinInherited.type).toBe('capsule');
        expect(shinInherited.size).toEqual([0.049]);
        expect(shinInherited.fromto).toEqual([0, 0, 0, 0, 0, -0.3]);
    });

    it('parses axisangle orientation using compiler angle units', () => {
        const doc = new DOMParser().parseFromString('<geom axisangle="0 0 1 90" />', 'text/xml');
        const geom = doc.querySelector('geom');
        const origin = MJCFAdapter.parseOrigin(geom, 'degree');

        expect(origin.rpy[2]).toBeCloseTo(Math.PI / 2);
    });

    it('parses xyaxes orientation', () => {
        const doc = new DOMParser().parseFromString('<camera xyaxes="0 -1 0 1 0 0" />', 'text/xml');
        const camera = doc.querySelector('camera');
        const origin = MJCFAdapter.parseOrigin(camera, 'radian');

        expect(origin.quat).toBeDefined();
        expect(Math.abs(origin.rpy[2])).toBeCloseTo(Math.PI / 2, 4);
    });

    it('parses zaxis orientation', () => {
        const doc = new DOMParser().parseFromString('<geom zaxis="1 0 0" />', 'text/xml');
        const geom = doc.querySelector('geom');
        const origin = MJCFAdapter.parseOrigin(geom, 'radian');
        const rotatedZ = rotateVectorByQuaternion([0, 0, 1], origin.quat || [0, 0, 0, 1]);

        expect(origin.quat).toBeDefined();
        expect(rotatedZ[0]).toBeCloseTo(1, 4);
        expect(rotatedZ[1]).toBeCloseTo(0, 4);
        expect(rotatedZ[2]).toBeCloseTo(0, 4);
    });
});
