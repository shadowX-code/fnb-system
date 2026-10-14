import {it,expect} from 'vitest';
import {xhsState} from '../../../../server/creatorExtraction/xhsState.mjs';
it('preserves literal text and escapes while parsing spaced state with bare JS values and trailing code',()=>{
 const state={text:'a } :undefined, NaN Infinity \\" <tag>',array:[null,{a:1}]};const source='window.__INITIAL_STATE__ \n = '+JSON.stringify(state).replace('"a":1','"a":undefined')+'; unsafeFunction();';expect(xhsState(source)).toEqual({...state,array:[null,{a:null}]});expect(xhsState('window.__INITIAL_STATE__={"a":[NaN,Infinity,-Infinity,undefined]}')).toEqual({a:[null,null,null,null]});
});
it('rejects expressions and malformed/unbalanced objects without execution',()=>{
 for(const source of ['window.__INITIAL_STATE__=alert(1)','window.__INITIAL_STATE__={"a":(()=>1)()}','window.__INITIAL_STATE__={"a":undefinedValue}','window.__INITIAL_STATE__={"a":"unterminated'])expect(xhsState(source)).toBeNull();
});
