import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./fixtureService.js',import.meta.url));
export default defineConfig(({command})=>{
 if(command!=='serve')throw new Error('Management renderer fixtures cannot be deployed');
 return {root:fileURLToPath(new URL('../../',import.meta.url)),plugins:[react()],envDir:false,optimizeDeps:{entries:['qa/native-assistant-management/index.html']},resolve:{alias:[{find:/.*\/nativeAssistantService\.js$/,replacement:fixture}]},server:{host:'127.0.0.1',port:4177,strictPort:true}};
});
