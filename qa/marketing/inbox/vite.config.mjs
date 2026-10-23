import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./fixtureService.js',import.meta.url));
export default defineConfig(({command})=>{
 if(command!=='serve')throw new Error('Inbox renderer fixtures cannot be deployed');
 return {root:fileURLToPath(new URL('../../../',import.meta.url)),plugins:[react()],envDir:false,optimizeDeps:{entries:['qa/marketing/inbox/index.html']},resolve:{alias:[{find:/.*\/AuthContext\.jsx$/,replacement:fixture},{find:/.*\/marketingService\.js$/,replacement:fixture},{find:/.*\/inboxService\.js$/,replacement:fixture}]},server:{host:'127.0.0.1',port:4181,strictPort:true}};
});
