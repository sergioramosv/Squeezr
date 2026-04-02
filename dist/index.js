import { createAdaptorServer } from '@hono/node-server';
import { app, stats } from './server.js';
import { config } from './config.js';
import { VERSION } from './version.js';
import { startMitmProxy } from './codexMitm.js';
const PORT = config.port;
const httpServer = createAdaptorServer({ fetch: app.fetch });
httpServer.listen(PORT, () => {
    console.log(`Squeezr v${VERSION} listening on http://localhost:${PORT}`);
    console.log(`Mode: ${config.dryRun ? 'dry-run' : 'active'}`);
    if (config.disabled)
        console.log('WARNING: compression is disabled');
    console.log(`Backends: Anthropic → Haiku | OpenAI → GPT-4o-mini | Gemini → Flash-8B | Local → ${config.localCompressionModel}`);
    console.log(`Stats: http://localhost:${PORT}/squeezr/stats`);
});
// Start MITM proxy for Codex OAuth (chatgpt.com/backend-api)
startMitmProxy();
const isDaemon = !!process.env.SQUEEZR_DAEMON;
if (isDaemon) {
    process.on('SIGINT', () => { });
    process.on('SIGHUP', () => { });
}
else {
    process.on('SIGINT', () => {
        const s = stats.summary();
        console.log(`\n[squeezr] Session summary: ${s.requests} requests | -${s.total_saved_chars.toLocaleString()} chars (~${s.total_saved_tokens.toLocaleString()} tokens, ${s.savings_pct}% saved)`);
        process.exit(0);
    });
}
process.on('SIGTERM', () => process.exit(0));
