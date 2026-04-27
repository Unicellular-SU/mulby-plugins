type InitAttachment = { path?: string; name?: string };
type InitPayload = { input?: unknown; attachments?: InitAttachment[] };
type ClipboardFile = { path?: string; name?: string };

function parseInputToPdfPaths(input: unknown): string[] {
    if (typeof input !== 'string') return [];
    const trimmed = input.trim();
    if (!trimmed) return [];

    const paths = new Set<string>();
    if (/\.pdf$/i.test(trimmed)) {
        paths.add(trimmed);
    }

    trimmed
        .split(/[\n,;]/)
        .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
        .filter(part => /\.pdf$/i.test(part))
        .forEach(part => paths.add(part));

    try {
        const parsed = JSON.parse(trimmed) as { text?: unknown; input?: unknown; attachments?: Array<{ path?: unknown }> };
        if (typeof parsed.text === 'string' && /\.pdf$/i.test(parsed.text.trim())) {
            paths.add(parsed.text.trim());
        }
        if (typeof parsed.input === 'string' && /\.pdf$/i.test(parsed.input.trim())) {
            paths.add(parsed.input.trim());
        }
        (parsed.attachments || [])
            .map(item => item?.path)
            .filter((path): path is string => typeof path === 'string' && /\.pdf$/i.test(path))
            .forEach(path => paths.add(path));
    } catch {
        // not JSON input
    }

    return [...paths];
}

function deduplicatePaths(paths: string[]): string[] {
    const unique = [...new Set(paths)];
    if (unique.length <= 1) return unique;
    const fullPaths = new Set(unique.filter(p => p.includes('/') || p.includes('\\')));
    return unique.filter(p => {
        if (fullPaths.has(p)) return true;
        const name = p;
        for (const fp of fullPaths) {
            if (fp.endsWith('/' + name) || fp.endsWith('\\' + name)) return false;
        }
        return true;
    });
}

export async function getInitPdfPaths(
    payload?: InitPayload,
    readClipboardFiles?: () => ClipboardFile[] | Promise<ClipboardFile[]>
): Promise<string[]> {
    const fromAttachments = (payload?.attachments || [])
        .map(item => item?.path)
        .filter((path): path is string => typeof path === 'string' && /\.pdf$/i.test(path));

    const fromInput = parseInputToPdfPaths(payload?.input);
    const all = deduplicatePaths([...fromAttachments, ...fromInput]);
    if (all.length) return all;

    if (!readClipboardFiles) return [];
    try {
        const files = await readClipboardFiles();
        return [...new Set(
            (files || [])
                .map(file => file?.path)
                .filter((path): path is string => typeof path === 'string' && /\.pdf$/i.test(path))
        )];
    } catch {
        return [];
    }
}
