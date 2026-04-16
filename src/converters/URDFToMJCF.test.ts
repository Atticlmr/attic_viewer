import { describe, expect, it } from 'vitest';
import { URDFParser } from './parsers/URDFParser.js';
import { MJCFSerializer } from './serializers/MJCFSerializer.js';

describe('URDF -> MJCF conversion', () => {
    it('parses URDF with package assets and serializes MJCF with equality and actuators', async () => {
        const urdf = `<?xml version="1.0"?>
<robot name="demo_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://robot_pkg/meshes/base.stl" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
  <link name="arm_link" />
  <link name="finger_link" />
  <joint name="arm_joint" type="revolute">
    <parent link="base_link" />
    <child link="arm_link" />
    <origin xyz="0 0 0.1" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-1.57" upper="1.57" effort="12" velocity="2" />
  </joint>
  <joint name="finger_joint" type="prismatic">
    <parent link="arm_link" />
    <child link="finger_link" />
    <origin xyz="0 0 0.2" rpy="0 0 0" />
    <axis xyz="1 0 0" />
    <limit lower="0" upper="0.04" effort="8" velocity="0.5" />
    <mimic joint="arm_joint" multiplier="-0.5" offset="0.02" />
  </joint>
  <transmission name="arm_transmission">
    <type>transmission_interface/SimpleTransmission</type>
    <joint name="arm_joint">
      <hardwareInterface>hardware_interface/PositionJointInterface</hardwareInterface>
    </joint>
    <actuator name="arm_motor">
      <hardwareInterface>hardware_interface/PositionJointInterface</hardwareInterface>
      <mechanicalReduction>3</mechanicalReduction>
    </actuator>
  </transmission>
</robot>`;

        const parser = new URDFParser();
        const serializer = new MJCFSerializer();
        const fileMap = new Map<string, File>([
            ['robot_pkg/package.xml', new File(['<package><name>robot_pkg</name></package>'], 'package.xml', { type: 'application/xml' })],
            ['robot_pkg/meshes/base.stl', new File(['solid base\nendsolid base'], 'base.stl', { type: 'model/stl' })]
        ]);

        const parsed = await parser.parse({
            format: 'urdf',
            fileName: 'demo.urdf',
            path: 'robot_pkg/urdf/demo.urdf',
            content: urdf,
            fileMap
        }, {
            fileMap,
            basePath: 'robot_pkg/urdf'
        });

        expect(parsed.document.geometry.visuals[0].geometry.kind).toBe('mesh');
        if (parsed.document.geometry.visuals[0].geometry.kind !== 'mesh') {
            throw new Error('Expected mesh geometry');
        }
        expect(parsed.document.geometry.visuals[0].geometry.resolvedUri).toBe('robot_pkg/meshes/base.stl');

        const serialized = await serializer.serialize(parsed.document, {
            format: 'mjcf',
            fileName: 'demo_robot.mjcf'
        }, {
            pretty: true
        });

        expect(serialized.format).toBe('mjcf');
        expect(typeof serialized.content).toBe('string');
        if (typeof serialized.content !== 'string') {
            throw new Error('Expected string MJCF output');
        }

        expect(serialized.content).toContain('<mujoco model="demo_robot">');
        expect(serialized.content).toContain('<mesh name="base" file="mesh/base.stl"');
        expect(serialized.content).toContain('<joint name="arm_joint" type="hinge"');
        expect(serialized.content).toContain('<joint name="finger_joint" type="slide"');
        expect(serialized.content).toContain('<equality>');
        expect(serialized.content).toContain('joint1="finger_joint" joint2="arm_joint" polycoef="0.02 -0.5 0 0 0"');
        expect(serialized.content).toContain('<actuator>');
        expect(serialized.content).toContain('<position name="arm_motor" joint="arm_joint" gear="3"');
        expect(serialized.content).toContain('ctrlrange="-1.57 1.57"');

        expect(serialized.artifacts).toBeDefined();
        expect(serialized.artifacts?.some(artifact => artifact.fileName === 'mesh/base.stl' && artifact.sourcePath === 'robot_pkg/meshes/base.stl')).toBe(true);
    });
});
