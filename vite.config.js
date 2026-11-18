import { loadEnv, defineConfig } from 'vite';
export default defineConfig({server:{host:'127.0.0.1',fs:{deny:['.env','.env.*','**/.git/**','**/.server-data/**','**/server/**']},proxy:{'/api': 'http://127.0.0.1:' + (process.env.PORT || 3001)}}});
