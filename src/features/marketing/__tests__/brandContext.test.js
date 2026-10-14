import {describe,it,expect,vi} from 'vitest';
import {resolveBrandContext,selectBrandContext} from '../brandContext.js';
const context={organizations:[{id:'one'},{id:'two'}],brands:[{id:'a',organization_id:'one'},{id:'b',organization_id:'two'},{id:'hidden',organization_id:'foreign'}]};
describe('Brand-derived internal scope',()=>{
 it('prefers the authorized Brand over a stale legacy scope',()=>expect(resolveBrandContext(context,'b','one')).toEqual({org:'two',brand:'b'}));
 it('does not trust unknown Brands or scopes',()=>expect(resolveBrandContext(context,'hidden','foreign')).toEqual({org:'one',brand:''}));
 it('retains the current security boundary for All Brands',()=>expect(resolveBrandContext(context,'','two')).toEqual({org:'two',brand:''}));
 it('changes Brand and tenant together',()=>{const scope=vi.fn(),brand=vi.fn();selectBrandContext(context,'b','one',scope,brand);expect(scope).toHaveBeenCalledWith('two');expect(brand).toHaveBeenCalledWith('b')});
 it('does not invent access when none is available',()=>expect(resolveBrandContext({organizations:[],brands:[]},'a','one')).toEqual({org:'',brand:''}));
});
