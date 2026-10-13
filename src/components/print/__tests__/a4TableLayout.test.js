import { describe, expect, it } from "vitest";
import { a4ColumnBands, a4Dimensions, paginateA4Rows } from "../a4TableLayout.js";
describe("Shared A4 table layout",()=>{
  it("uses exact A4 dimensions in both orientations",()=>{
    expect(a4Dimensions("landscape")).toEqual({width:297,height:210});
    expect(a4Dimensions("portrait")).toEqual({width:210,height:297});
  });
  it("continues wide column selections at readable widths and repeats selected identity",()=>{
    const columns=[{key:"product",repeat:true,minWidth:52},{key:"sku",repeat:true,minWidth:22},...Array.from({length:10},(_,i)=>({key:i,minWidth:30}))];
    for(const orientation of ["portrait","landscape"]){
      const bands=a4ColumnBands(columns,orientation);
      expect(bands.length).toBeGreaterThan(1);
      expect(bands.flatMap(b=>b.filter(c=>!c.repeat))).toHaveLength(10);
      bands.forEach(b=>{expect(b.slice(0,2)).toEqual(columns.slice(0,2));expect(b.reduce((n,c)=>n+c.minWidth,0)).toBeLessThanOrEqual(a4Dimensions(orientation).width-24);});
    }
  });
  it("paginates variable bilingual row heights without losing or splitting records",()=>{
    const pages=paginateA4Rows([30,40,60,50,70],100);
    expect(pages).toEqual([[0,1],[2],[3],[4]]);
    expect(pages.flat()).toEqual([0,1,2,3,4]);
    expect(()=>paginateA4Rows([101],100)).toThrow("too tall");
  });
});
