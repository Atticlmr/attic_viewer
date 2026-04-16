import { describe, expect, it } from 'vitest';
import { MJCFParser } from './parsers/MJCFParser.js';
import { URDFSerializer } from './serializers/URDFSerializer.js';

describe('MJCF -> URDF conversion', () => {
    it('parses MJCF assets, equality, and actuators and serializes URDF output', async () => {
        const mjcf = `<?xml version="1.0"?>
<mujoco model="demo_robot">
  <compiler angle="radian" />
  <default class="visual_defaults">
    <geom group="1" contype="0" conaffinity="0" density="0" material="blue" />
    <joint damping="0.2" />
  </default>
  <asset>
    <mesh name="base" file="meshes/base.stl" scale="1 1 1" />
    <material name="blue" rgba="0.1 0.2 0.8 1" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom name="base_visual" class="visual_defaults" type="mesh" mesh="base" />
      <body name="arm_link" pos="0 0 0.1">
        <joint name="arm_joint" type="hinge" axis="0 0 1" range="-1.57 1.57" />
        <geom name="arm_collision" type="capsule" size="0.02 0.15" group="3" />
        <body name="finger_link" pos="0 0 0.2">
          <joint name="finger_joint" type="slide" axis="1 0 0" range="0 0.04" />
          <joint name="twist_joint" type="hinge" axis="0 1 0" pos="0 0 0.02" range="-0.2 0.2" />
        </body>
      </body>
    </body>
  </worldbody>
  <equality>
    <joint name="finger_mimic" joint1="finger_joint" joint2="arm_joint" polycoef="0.02 -0.5 0 0 0" />
  </equality>
  <actuator>
    <position name="arm_servo" joint="arm_joint" gear="3" ctrlrange="-1.57 1.57" kp="20" />
  </actuator>
</mujoco>`;

        const parser = new MJCFParser();
        const serializer = new URDFSerializer();
        const fileMap = new Map<string, File>([
            ['robot_pkg/meshes/base.stl', new File(['solid base\nendsolid base'], 'base.stl', { type: 'model/stl' })]
        ]);

        const parsed = await parser.parse({
            format: 'mjcf',
            fileName: 'model.xml',
            path: 'robot_pkg/model.xml',
            content: mjcf,
            fileMap
        }, {
            fileMap,
            basePath: 'robot_pkg'
        });

        expect(parsed.document.structure.rootLink).toBe('base_link');
        expect(parsed.document.geometry.visuals[0].geometry.kind).toBe('mesh');
        if (parsed.document.geometry.visuals[0].geometry.kind !== 'mesh') {
            throw new Error('Expected mesh geometry');
        }
        expect(parsed.document.geometry.visuals[0].geometry.resolvedUri).toBe('robot_pkg/meshes/base.stl');
        expect(parsed.document.geometry.visuals[0].material).toBe('blue');
        expect(parsed.document.structure.joints.some(joint => joint.name === 'arm_joint' && joint.type === 'revolute')).toBe(true);
        expect(parsed.document.structure.joints.some(joint => joint.name === 'finger_joint' && joint.type === 'prismatic')).toBe(true);
        expect(parsed.document.structure.joints.some(joint => joint.name === 'twist_joint' && joint.type === 'revolute')).toBe(true);
        expect(parsed.document.structure.links.length).toBe(4);

        const serialized = await serializer.serialize(parsed.document, {
            format: 'urdf',
            fileName: 'demo_robot.urdf'
        }, {
            pretty: true
        });

        expect(serialized.format).toBe('urdf');
        expect(typeof serialized.content).toBe('string');
        if (typeof serialized.content !== 'string') {
            throw new Error('Expected string URDF output');
        }

        expect(serialized.content).toContain('<robot name="demo_robot">');
        expect(serialized.content).toContain('<link name="base_link">');
        expect(serialized.content).toContain('<mesh filename="mesh/base.stl" scale="1 1 1" />');
        expect(serialized.content).toContain('<joint name="arm_joint" type="revolute">');
        expect(serialized.content).toContain('<joint name="finger_joint" type="prismatic">');
        expect(serialized.content).toContain('<joint name="twist_joint" type="revolute">');
        expect(serialized.content).toContain('<mimic joint="arm_joint" multiplier="-0.5" offset="0.02" />');
        expect(serialized.content).toContain('<transmission name="arm_servo_transmission">');
        expect(serialized.content).toContain('hardware_interface/PositionJointInterface');
        expect(serialized.losses.some(loss => loss.field === 'geometry.capsule')).toBe(true);
        expect(serialized.artifacts).toBeDefined();
        expect(serialized.artifacts?.some(artifact => artifact.fileName === 'mesh/base.stl' && artifact.sourcePath === 'robot_pkg/meshes/base.stl')).toBe(true);
    });
});
