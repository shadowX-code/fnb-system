import { afterEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NetworkEdge } from './NetworkGraph.jsx';

afterEach(() => vi.restoreAllMocks());

it('uses distance-based speed and preserves mounted particle progress through focus and route updates', () => {
  let length = 850;
  Object.defineProperty(SVGElement.prototype, 'getTotalLength', {configurable:true,value:vi.fn(() => length)});
  const clocks = new WeakMap();
  Object.defineProperty(SVGElement.prototype, 'getAnimations', {configurable:true,value:function () {
    if (!clocks.has(this)) clocks.set(this, [{currentTime:4000}]);
    return clocks.get(this);
  }});
  const props = {id:'ambient',sourceX:0,sourceY:0,targetX:250,targetY:200,sourcePosition:'bottom',targetPosition:'top',data:{kind:'dependency',ambientMotion:true}};
  const {container,rerender} = render(<svg><NetworkEdge {...props}/></svg>);
  const particle = container.querySelector('.son-motion-particle');
  expect(particle.style.animationDuration).toBe('10s');
  const before = clocks.get(particle)[0].currentTime;
  const delay = Number.parseFloat(particle.style.animationDelay)*1000;
  rerender(<svg><NetworkEdge {...props} data={{...props.data,focused:true}}/></svg>);
  expect(container.querySelector('.son-motion-particle')).toBe(particle);
  expect(clocks.get(particle)[0].currentTime).toBe(before);
  length = 1700;
  rerender(<svg><NetworkEdge {...props} targetY={400}/></svg>);
  expect(container.querySelector('.son-motion-particle')).toBe(particle);
  expect(particle.style.animationDuration).toBe('20s');
  const nextDelay = Number.parseFloat(particle.style.animationDelay)*1000;
  expect((clocks.get(particle)[0].currentTime-nextDelay)/20000).toBeCloseTo((before-delay)/10000);
  delete SVGElement.prototype.getTotalLength;
  delete SVGElement.prototype.getAnimations;
});
