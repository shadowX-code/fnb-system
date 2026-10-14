// Parse only the assigned data object; never evaluate provider JavaScript.
export function xhsState(script){
 if(typeof script!=='string'||script.length>5000000)return null;
 const marker=/window\.__INITIAL_STATE__\s*=\s*/.exec(script);if(!marker)return null;
 const start=marker.index+marker[0].length;if(script[start]!=='{')return null;
 let depth=0,string=false,escaped=false;const output=[];
 for(let i=start;i<script.length;i++){
  const char=script[i];
  if(string){output.push(char);if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')string=false;continue}
  if(char==='"'){string=true;output.push(char);continue}
  if(char==='{')depth++;
  if(char==='}'){depth--;output.push(char);if(depth===0){try{return JSON.parse(output.join(''))}catch{return null}}continue}
  const token=/^(?:undefined|NaN|-?Infinity)(?=\s*[,}\]])/.exec(script.slice(i,i+32));
  if(token){output.push('null');i+=token[0].length-1}else output.push(char);
 }
 return null;
}
