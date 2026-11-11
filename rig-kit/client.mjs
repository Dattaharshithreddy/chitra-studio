import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
const [tool, argsJson] = process.argv.slice(2);
const t = new StdioClientTransport({ command: 'node', args: [new URL('./node_modules/rive-mcp-server/dist/index.js', import.meta.url).pathname], env: { ...process.env } });
const c = new Client({ name: 'test', version: '1' }); await c.connect(t);
if (tool === 'list') { const r = await c.listTools(); console.log(r.tools.length, 'tools'); }
else {
  const r = await c.callTool({ name: tool, arguments: JSON.parse(argsJson.startsWith('@') ? fs.readFileSync(argsJson.slice(1), 'utf8') : argsJson) }, undefined, { timeout: 600000 });
  let i = 0; for (const x of r.content) { if (x.type === 'text') console.log(x.text.slice(0, 1500)); else if (x.type === 'image') { const f = `/tmp/rive_${tool}_${i++}.png`; fs.writeFileSync(f, Buffer.from(x.data, 'base64')); console.log('image ->', f); } }
}
await c.close();
