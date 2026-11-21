import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseAgyStatus } from './agy-status';
import { parseClaudeStatus } from './claude-status';

const [destination, original, source] = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
try {
    const metrics = source === 'claude' ? parseClaudeStatus(input) : parseAgyStatus(input);
    if (metrics) {
        const pending = destination + '.next-' + process.pid;
        writeFileSync(pending, JSON.stringify(metrics), { mode: 0o600 });
        renameSync(pending, destination);
    }
} catch { /* The original status line still works if the workbench disconnects. */ }

if (original && original !== '-') {
    const command = Buffer.from(original, 'base64').toString('utf8');
    const result = spawnSync(command, { shell: true, input, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    process.exitCode = result.status ?? 1;
}
