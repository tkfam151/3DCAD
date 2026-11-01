// Feature definitions: parameter schemas shared by the kernel and the UI.

export const OPERATIONS = [
  { value: 'new', label: 'New Body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
];

export const PLANES = [
  { value: 'XY', label: 'XY (Top)' },
  { value: 'XZ', label: 'XZ (Front)' },
  { value: 'YZ', label: 'YZ (Right)' },
];

export const AXES = [
  { value: 'X', label: 'X axis' },
  { value: 'Y', label: 'Y axis' },
  { value: 'Z', label: 'Z axis' },
];

const notNew = (p) => p.operation && p.operation !== 'new';

const OP = [
  { key: 'operation', label: 'Operation', type: 'select', options: OPERATIONS, default: 'new' },
  { key: 'target', label: 'Target body', type: 'body', showIf: notNew },
];

const PLACE = [
  { key: 'x', label: 'X', type: 'number', default: '0', group: 'Position' },
  { key: 'y', label: 'Y', type: 'number', default: '0', group: 'Position' },
  { key: 'z', label: 'Z', type: 'number', default: '0', group: 'Position' },
  { key: 'rx', label: 'Rot X°', type: 'number', default: '0', group: 'Rotation' },
  { key: 'ry', label: 'Rot Y°', type: 'number', default: '0', group: 'Rotation' },
  { key: 'rz', label: 'Rot Z°', type: 'number', default: '0', group: 'Rotation' },
];

export const FEATURES = {
  sketch: {
    label: 'Sketch',
    icon: 'sketch',
    fields: [
      { key: 'plane', label: 'Plane', type: 'select', options: [...PLANES, { value: 'custom', label: 'Face / custom' }], default: 'XY' },
      { key: 'offset', label: 'Offset', type: 'number', default: '0' },
    ],
  },
  extrude: {
    label: 'Extrude',
    icon: 'extrude',
    fields: [
      { key: 'sketch', label: 'Profile sketch', type: 'sketch' },
      { key: 'distance', label: 'Distance', type: 'number', default: '10' },
      {
        key: 'direction', label: 'Direction', type: 'select', default: 'one',
        options: [
          { value: 'one', label: 'One side' },
          { value: 'reverse', label: 'Flip' },
          { value: 'symmetric', label: 'Symmetric' },
        ],
      },
      { key: 'cornerRadius', label: 'Round corners', type: 'number', default: '0' },
      { key: 'taper', label: 'Top scale %', type: 'number', default: '100' },
      { key: 'twist', label: 'Twist °', type: 'number', default: '0' },
      ...OP,
    ],
  },
  revolve: {
    label: 'Revolve',
    icon: 'revolve',
    fields: [
      { key: 'sketch', label: 'Profile sketch', type: 'sketch' },
      {
        key: 'axis', label: 'Axis', type: 'select', default: 'V',
        options: [
          { value: 'V', label: 'Sketch vertical axis' },
          { value: 'U', label: 'Sketch horizontal axis' },
        ],
      },
      { key: 'angle', label: 'Angle °', type: 'number', default: '360' },
      ...OP,
    ],
  },
  box: {
    label: 'Box',
    icon: 'box',
    fields: [
      { key: 'width', label: 'Width (X)', type: 'number', default: '20' },
      { key: 'depth', label: 'Depth (Y)', type: 'number', default: '20' },
      { key: 'height', label: 'Height (Z)', type: 'number', default: '20' },
      { key: 'fillet', label: 'Edge fillet', type: 'number', default: '0' },
      ...OP,
      ...PLACE,
    ],
  },
  cylinder: {
    label: 'Cylinder',
    icon: 'cylinder',
    fields: [
      { key: 'radius', label: 'Radius', type: 'number', default: '10' },
      { key: 'height', label: 'Height', type: 'number', default: '20' },
      { key: 'fillet', label: 'Edge fillet', type: 'number', default: '0' },
      ...OP,
      ...PLACE,
    ],
  },
  sphere: {
    label: 'Sphere',
    icon: 'sphere',
    fields: [
      { key: 'radius', label: 'Radius', type: 'number', default: '10' },
      ...OP,
      ...PLACE.slice(0, 3),
    ],
  },
  cone: {
    label: 'Cone',
    icon: 'cone',
    fields: [
      { key: 'radius', label: 'Bottom radius', type: 'number', default: '10' },
      { key: 'topRadius', label: 'Top radius', type: 'number', default: '0' },
      { key: 'height', label: 'Height', type: 'number', default: '20' },
      ...OP,
      ...PLACE,
    ],
  },
  torus: {
    label: 'Torus',
    icon: 'torus',
    fields: [
      { key: 'majorRadius', label: 'Ring radius', type: 'number', default: '15' },
      { key: 'minorRadius', label: 'Tube radius', type: 'number', default: '4' },
      ...OP,
      ...PLACE,
    ],
  },
  move: {
    label: 'Move',
    icon: 'move',
    fields: [
      { key: 'target', label: 'Body', type: 'body' },
      { key: 'tx', label: 'Move X', type: 'number', default: '0', group: 'Translate' },
      { key: 'ty', label: 'Move Y', type: 'number', default: '0', group: 'Translate' },
      { key: 'tz', label: 'Move Z', type: 'number', default: '0', group: 'Translate' },
      { key: 'rx', label: 'Rot X°', type: 'number', default: '0', group: 'Rotate' },
      { key: 'ry', label: 'Rot Y°', type: 'number', default: '0', group: 'Rotate' },
      { key: 'rz', label: 'Rot Z°', type: 'number', default: '0', group: 'Rotate' },
      { key: 'px', label: 'Pivot X', type: 'number', default: '0', group: 'Pivot' },
      { key: 'py', label: 'Pivot Y', type: 'number', default: '0', group: 'Pivot' },
      { key: 'pz', label: 'Pivot Z', type: 'number', default: '0', group: 'Pivot' },
      { key: 'copy', label: 'Create copy', type: 'bool', default: false },
    ],
  },
  scale: {
    label: 'Scale',
    icon: 'scale',
    fields: [
      { key: 'target', label: 'Body', type: 'body' },
      { key: 'sx', label: 'Scale X', type: 'number', default: '1' },
      { key: 'sy', label: 'Scale Y', type: 'number', default: '1' },
      { key: 'sz', label: 'Scale Z', type: 'number', default: '1' },
      { key: 'about', label: 'About', type: 'select', default: 'center', options: [
        { value: 'center', label: 'Body center' },
        { value: 'origin', label: 'Origin' },
      ] },
    ],
  },
  combine: {
    label: 'Combine',
    icon: 'combine',
    fields: [
      { key: 'target', label: 'Target body', type: 'body' },
      { key: 'tools', label: 'Tool bodies', type: 'bodies' },
      { key: 'operation', label: 'Operation', type: 'select', default: 'join', options: OPERATIONS.slice(1) },
      { key: 'keepTools', label: 'Keep tool bodies', type: 'bool', default: false },
    ],
  },
  mirror: {
    label: 'Mirror',
    icon: 'mirror',
    fields: [
      { key: 'target', label: 'Body', type: 'body' },
      { key: 'plane', label: 'Mirror plane', type: 'select', options: PLANES, default: 'YZ' },
      { key: 'offset', label: 'Plane offset', type: 'number', default: '0' },
      { key: 'join', label: 'Join to original', type: 'bool', default: true },
    ],
  },
  linearPattern: {
    label: 'Linear Pattern',
    icon: 'linear',
    fields: [
      { key: 'target', label: 'Body', type: 'body' },
      { key: 'axis', label: 'Direction 1', type: 'select', options: AXES, default: 'X' },
      { key: 'count', label: 'Count 1', type: 'number', default: '3' },
      { key: 'spacing', label: 'Spacing 1', type: 'number', default: '30' },
      { key: 'axis2', label: 'Direction 2', type: 'select', options: AXES, default: 'Y' },
      { key: 'count2', label: 'Count 2', type: 'number', default: '1' },
      { key: 'spacing2', label: 'Spacing 2', type: 'number', default: '30' },
      { key: 'join', label: 'Join into one body', type: 'bool', default: true },
    ],
  },
  circularPattern: {
    label: 'Circular Pattern',
    icon: 'circular',
    fields: [
      { key: 'target', label: 'Body', type: 'body' },
      { key: 'axis', label: 'Axis', type: 'select', options: AXES, default: 'Z' },
      { key: 'cx', label: 'Center X', type: 'number', default: '0', group: 'Axis point' },
      { key: 'cy', label: 'Center Y', type: 'number', default: '0', group: 'Axis point' },
      { key: 'cz', label: 'Center Z', type: 'number', default: '0', group: 'Axis point' },
      { key: 'count', label: 'Count', type: 'number', default: '6' },
      { key: 'angle', label: 'Total angle °', type: 'number', default: '360' },
      { key: 'join', label: 'Join into one body', type: 'bool', default: true },
    ],
  },
  shell: {
    label: 'Hollow',
    icon: 'shell',
    fields: [
      { key: 'target', label: 'Body', type: 'body' },
      { key: 'thickness', label: 'Wall thickness', type: 'number', default: '2' },
    ],
  },
  remove: {
    label: 'Remove Body',
    icon: 'trash',
    fields: [{ key: 'target', label: 'Body', type: 'body' }],
  },
  importMesh: {
    label: 'Imported Mesh',
    icon: 'import',
    fields: [
      ...OP,
      ...PLACE,
      { key: 'scale', label: 'Scale', type: 'number', default: '1' },
    ],
  },
};

export function defaultParams(type) {
  const params = {};
  for (const f of FEATURES[type].fields) {
    if (f.default !== undefined) params[f.key] = f.default;
  }
  return params;
}

/** Fields that reference bodies, used for dependency checks when deleting. */
export function referencedBodies(feature) {
  const out = [];
  const p = feature.params || {};
  if (p.target) out.push(p.target);
  if (Array.isArray(p.tools)) out.push(...p.tools);
  return out;
}
