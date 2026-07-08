import { defineConfig } from 'vite';
import { execSync } from 'child_process';

// Helper to run git commands safely
function runGit(cmd) {
    try {
        return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (e) {
        return '';
    }
}

// Generate local dev info string
function getLocalDeployInfo() {
    const fullSha = runGit('git rev-parse HEAD');
    const shortSha = fullSha.substring(0, 8);
    const branch = runGit('git rev-parse --abbrev-ref HEAD');
    const isDirty = runGit('git status --porcelain').length > 0;
    
    const dirtyText = isDirty ? ' (dirty)' : '';
    
    if (!shortSha) return '<div style="text-align: center;">LOCAL DEVELOPMENT</div>';
    return `<div style="text-align: center;">LOCAL DEVELOPMENT</div>` +
           `<div style="text-align: left;">Branch: ${branch}</div>` +
           `<div style="text-align: left;">Commit: ${shortSha}${dirtyText}</div>`;
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  define: {
    'import.meta.env.VITE_DEPLOY_INFO': JSON.stringify(process.env.VITE_DEPLOY_INFO || getLocalDeployInfo())
  }
});