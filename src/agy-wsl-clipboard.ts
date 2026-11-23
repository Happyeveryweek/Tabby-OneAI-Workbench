import { execFile } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Platform } from './host';
import type { Project } from './commands';
import { runtimeProject } from './commands';

const exec = promisify(execFile);
const wsl = 'wsl.exe';
const probeOptions = { timeout: 12000, windowsHide: true };

const clipRoot = join(tmpdir(), 'tabby-oneai-clipboard');
const clipPngPath = join(clipRoot, 'latest.png');
const clipPngTmpPath = join(clipRoot, 'latest.png.tmp');
const clipStatePath = join(clipRoot, 'state.txt');

export interface AgyWslClipboardBridge {
    binDir: string;
    wslClipDir: string;
}

const preparedByDistro = new Map<string, Promise<AgyWslClipboardBridge>>();

const wlPasteShim = `#!/bin/sh
set -eu
CLIP_DIR="\${TABBY_ONEAI_CLIP_DIR:-}"
[ -n "$CLIP_DIR" ] || exit 1
PNG="$CLIP_DIR/latest.png"
STATE="$CLIP_DIR/state.txt"

refresh_from_windows() {
    PS="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    [ -x "$PS" ] || return 1
    if "$PS" -NoProfile -NonInteractive -STA -Command 'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $d = Join-Path $env:TEMP "tabby-oneai-clipboard"; New-Item -ItemType Directory -Force -Path $d | Out-Null; $tmp = Join-Path $d "latest.png.tmp"; $out = Join-Path $d "latest.png"; $img.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose(); Move-Item -LiteralPath $tmp -Destination $out -Force; exit 0 }; exit 1' >/dev/null 2>&1; then
        printf '1\\n' > "$STATE" 2>/dev/null || true
        return 0
    fi
    printf '0\\n' > "$STATE" 2>/dev/null || true
    return 1
}

ensure_fresh() {
    now=$(date +%s)
    mtime=$(stat -c %Y "$STATE" 2>/dev/null || echo 0)
    age=$((now - mtime))
    if [ "$age" -ge 0 ] && [ "$age" -le 2 ]; then
        has=$(tr -d '\\r\\n' < "$STATE" 2>/dev/null || echo 0)
        [ "$has" = "1" ] && [ -s "$PNG" ] && return 0
        return 1
    fi
    refresh_from_windows && [ -s "$PNG" ]
}

LIST=0
MIME=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -l|--list-types) LIST=1 ;;
        -t|--type) shift; MIME="\${1:-}" ;;
        --type=*) MIME="\${1#--type=}" ;;
        -n|--no-newline|-p|--primary) ;;
        *) ;;
    esac
    shift || true
done

if [ "$LIST" = "1" ]; then
    ensure_fresh || exit 1
    printf 'image/png\\n'
    exit 0
fi

case "$MIME" in
    ""|image/png|image/*)
        ensure_fresh || exit 1
        cat "$PNG"
        exit 0
        ;;
    *)
        exit 1
        ;;
esac
`;

const xclipShim = `#!/bin/sh
set -eu
SELF_DIR=$(dirname "$0")
REAL_XCLIP=""
for d in /usr/local/bin /usr/bin /bin; do
    if [ -x "$d/xclip" ] && [ "$d/xclip" != "$0" ]; then
        REAL_XCLIP="$d/xclip"
        break
    fi
done
OUT=0
TARGET=""
PREV=""
for arg in "$@"; do
    case "$arg" in
        -o|-out) OUT=1 ;;
    esac
    if [ "$PREV" = "-t" ] || [ "$PREV" = "-target" ]; then
        TARGET="$arg"
        PREV=""
        continue
    fi
    PREV="$arg"
done
if [ "$OUT" = "1" ]; then
    if [ "$TARGET" = "TARGETS" ]; then
        if "$SELF_DIR/wl-paste" --list-types 2>/dev/null; then
            exit 0
        fi
    elif [ "$TARGET" = "image/png" ] || [ "$TARGET" = "image/*" ]; then
        if "$SELF_DIR/wl-paste" --type image/png; then
            exit 0
        fi
    fi
fi
if [ -n "$REAL_XCLIP" ]; then
    exec "$REAL_XCLIP" "$@"
fi
exit 1
`;

function readWindowsClipboardImagePng(platform?: Platform): Buffer | undefined {
    try {
        const hostPlatform = platform as { electron?: { clipboard?: { readImage?: () => { isEmpty(): boolean; toPNG(): Buffer } } } } | undefined;
        let clipboard = hostPlatform?.electron?.clipboard;
        if (!clipboard) {
            try { clipboard = (require('electron') as { clipboard?: typeof clipboard })?.clipboard; } catch {}
        }
        const image = clipboard?.readImage?.();
        if (!image || image.isEmpty()) return undefined;
        const png = image.toPNG();
        return png && png.length > 0 ? png : undefined;
    } catch {
        return undefined;
    }
}

export function syncAgyClipboardSnapshot(platform?: Platform): boolean {
    try {
        mkdirSync(clipRoot, { recursive: true });
        const png = readWindowsClipboardImagePng(platform);
        if (png) {
            writeFileSync(clipPngTmpPath, png);
            renameSync(clipPngTmpPath, clipPngPath);
            writeFileSync(clipStatePath, '1\n', 'utf8');
            return true;
        }
        writeFileSync(clipStatePath, '0\n', 'utf8');
        return false;
    } catch {
        return false;
    }
}

export function prepareAgyWslClipboard(project: Project): Promise<AgyWslClipboardBridge | undefined> {
    const distro = project.distro;
    if (!distro) return Promise.resolve(undefined);
    const key = distro.toLowerCase();
    const cached = preparedByDistro.get(key);
    if (cached) return cached;
    const task = (async (): Promise<AgyWslClipboardBridge> => {
        mkdirSync(clipRoot, { recursive: true });
        const wlB64 = Buffer.from(wlPasteShim, 'utf8').toString('base64');
        const xcB64 = Buffer.from(xclipShim, 'utf8').toString('base64');
        const script = [
            'set -e',
            'bin_dir="$HOME/.cache/tabby-oneai/clip-bin"',
            'mkdir -p "$bin_dir"',
            'printf "%s" "$1" | base64 -d > "$bin_dir/wl-paste"',
            'printf "%s" "$2" | base64 -d > "$bin_dir/xclip"',
            'chmod 755 "$bin_dir/wl-paste" "$bin_dir/xclip"',
            'clip_dir=$(wslpath -a -u "$3")',
            'printf "%s\\n%s\\n" "$bin_dir" "$clip_dir"',
        ].join('; ');
        const runtime = runtimeProject(distro);
        const { stdout } = await exec(
            wsl,
            ['--distribution', runtime.distro!, '--cd', runtime.directory, '--exec', 'bash', '-lc', script, '--', wlB64, xcB64, clipRoot],
            probeOptions,
        );
        const lines = stdout.trimEnd().split(/\r?\n/).slice(-2);
        const [binDir, wslClipDir] = lines;
        if (!binDir?.startsWith('/') || !wslClipDir?.startsWith('/')) {
            throw new Error('Failed to resolve WSL clipboard shim paths');
        }
        return { binDir, wslClipDir };
    })().catch(error => {
        preparedByDistro.delete(key);
        throw error;
    });
    preparedByDistro.set(key, task);
    return task;
}
