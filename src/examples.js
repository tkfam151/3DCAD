// Built-in example designs that show off the parametric workflow.

const base = () => ({ format: 'opencad', version: 1, parameters: [], settings: { segments: 64, units: 'mm' }, bodyProps: {}, sketchProps: {}, features: [] });

export function buildExamples() {
  const bracket = base();
  bracket.parameters = [
    { name: 'length', expr: '80' },
    { name: 'width', expr: '40' },
    { name: 'thickness', expr: '6' },
    { name: 'hole', expr: '6.5' },
  ];
  bracket.bodyProps = { b1: { name: 'Bracket', color: '#8fa6bf' } };
  bracket.features = [
    { id: 'b1', type: 'box', name: 'Base', params: { width: 'length', depth: 'width', height: 'thickness', fillet: '0', operation: 'new', x: '0', y: '0', z: '0', rx: '0', ry: '0', rz: '0' } },
    { id: 'b2', type: 'box', name: 'Upright', params: { width: 'thickness', depth: 'width', height: '40', fillet: '0', operation: 'join', target: 'b1', x: '-length/2 + thickness/2', y: '0', z: '0', rx: '0', ry: '0', rz: '0' } },
    { id: 's1', type: 'sketch', name: 'HoleSketch', params: { plane: 'XY', offset: '0' }, shapes: [
      { type: 'circle', cx: 10, cy: 0, r: 3.25 },
      { type: 'slot', x1: 22, y1: 0, x2: 32, y2: 0, r: 3.25 },
    ] },
    { id: 'e1', type: 'extrude', name: 'Holes', params: { sketch: 's1', distance: '20', direction: 'symmetric', cornerRadius: '0', taper: '100', twist: '0', operation: 'cut', target: 'b1' } },
    { id: 'c1', type: 'cylinder', name: 'SideHole', params: { radius: 'hole/2', height: '20', fillet: '0', operation: 'cut', target: 'b1', x: '-length/2 - 5', y: '0', z: '25', rx: '0', ry: '90', rz: '0' } },
  ];

  const enclosure = base();
  enclosure.parameters = [
    { name: 'w', expr: '70' }, { name: 'd', expr: '45' }, { name: 'h', expr: '30' }, { name: 'wall', expr: '2' },
  ];
  enclosure.bodyProps = { box: { name: 'Enclosure', color: '#6fb3b8' }, lid: { name: 'Lid', color: '#c9a26b' } };
  enclosure.features = [
    { id: 'box', type: 'box', name: 'Shell', params: { width: 'w', depth: 'd', height: 'h', fillet: '4', operation: 'new', x: '0', y: '0', z: '0', rx: '0', ry: '0', rz: '0' } },
    { id: 'hol', type: 'shell', name: 'Hollow1', params: { target: 'box', thickness: 'wall' } },
    { id: 'cut', type: 'box', name: 'OpenTop', params: { width: 'w+10', depth: 'd+10', height: '10', fillet: '0', operation: 'cut', target: 'box', x: '0', y: '0', z: 'h - 4', rx: '0', ry: '0', rz: '0' } },
    { id: 'usb', type: 'box', name: 'USBPort', params: { width: '12', depth: '10', height: '6', fillet: '0', operation: 'cut', target: 'box', x: 'w/2', y: '0', z: '8', rx: '0', ry: '0', rz: '0' } },
    { id: 'lid', type: 'box', name: 'Lid', params: { width: 'w', depth: 'd', height: 'wall', fillet: '0', operation: 'new', x: '0', y: 'd + 15', z: '0', rx: '0', ry: '0', rz: '0' } },
    { id: 'lip', type: 'box', name: 'LidLip', params: { width: 'w - 2*wall - 0.4', depth: 'd - 2*wall - 0.4', height: '3', fillet: '0', operation: 'join', target: 'lid', x: '0', y: 'd + 15', z: 'wall', rx: '0', ry: '0', rz: '0' } },
  ];

  const vase = base();
  vase.bodyProps = { r1: { name: 'Vase', color: '#c27d7d' } };
  vase.features = [
    { id: 's1', type: 'sketch', name: 'Profile', params: { plane: 'XZ', offset: '0' }, shapes: [
      { type: 'poly', closed: true, pts: [[0, 0], [22, 0], [30, 25], [24, 55], [14, 75], [17, 90], [15, 90], [12, 76], [21, 55], [27, 26], [20, 2], [0, 2]] },
    ] },
    { id: 'r1', type: 'revolve', name: 'Revolve1', params: { sketch: 's1', axis: 'V', angle: '360', operation: 'new' } },
  ];

  const wheel = base();
  wheel.parameters = [{ name: 'spokes', expr: '6' }, { name: 'R', expr: '40' }];
  wheel.bodyProps = { rim: { name: 'Wheel', color: '#9d8fc4' } };
  wheel.features = [
    { id: 'rim', type: 'torus', name: 'Rim', params: { majorRadius: 'R', minorRadius: '5', operation: 'new', x: '0', y: '0', z: '5', rx: '0', ry: '0', rz: '0' } },
    { id: 'hub', type: 'cylinder', name: 'Hub', params: { radius: '10', height: '10', fillet: '2', operation: 'join', target: 'rim', x: '0', y: '0', z: '0', rx: '0', ry: '0', rz: '0' } },
    { id: 'spk', type: 'box', name: 'Spoke', params: { width: 'R', depth: '5', height: '4', fillet: '0', operation: 'new', x: 'R/2', y: '0', z: '3', rx: '0', ry: '0', rz: '0' } },
    { id: 'pat', type: 'circularPattern', name: 'Spokes', params: { target: 'spk', axis: 'Z', cx: '0', cy: '0', cz: '0', count: 'spokes', angle: '360', join: true } },
    { id: 'cmb', type: 'combine', name: 'Assemble', params: { target: 'rim', tools: ['spk'], operation: 'join', keepTools: false } },
    { id: 'axle', type: 'cylinder', name: 'Axle', params: { radius: '4', height: '30', fillet: '0', operation: 'cut', target: 'rim', x: '0', y: '0', z: '-10', rx: '0', ry: '0', rz: '0' } },
  ];

  return [
    { name: 'Mounting Bracket', description: 'L-bracket driven by parameters, with sketched holes and a slot.', doc: bracket },
    { name: 'Electronics Enclosure', description: 'Rounded hollow box with port cutout and matching lid.', doc: enclosure },
    { name: 'Vase', description: 'A sketched profile revolved around an axis.', doc: vase },
    { name: 'Spoked Wheel', description: 'Torus rim, filleted hub and a circular pattern of spokes.', doc: wheel },
  ];
}
