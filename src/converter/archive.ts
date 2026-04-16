type ArchiveEntry = {
    path: string;
    content: Uint8Array;
};

const textEncoder = new TextEncoder();

export function createZipArchive(entries: ArchiveEntry[]): Uint8Array {
    const normalizedEntries = entries.map(entry => ({
        path: normalizeArchivePath(entry.path),
        content: entry.content
    }));
    const localChunks: Uint8Array[] = [];
    const centralChunks: Uint8Array[] = [];
    let offset = 0;

    normalizedEntries.forEach(entry => {
        const pathBytes = textEncoder.encode(entry.path);
        const content = entry.content;
        const crc = crc32(content);

        const localHeader = new Uint8Array(30 + pathBytes.length);
        writeUint32(localHeader, 0, 0x04034b50);
        writeUint16(localHeader, 4, 20);
        writeUint16(localHeader, 6, 0);
        writeUint16(localHeader, 8, 0);
        writeUint16(localHeader, 10, 0);
        writeUint16(localHeader, 12, 0);
        writeUint32(localHeader, 14, crc);
        writeUint32(localHeader, 18, content.length);
        writeUint32(localHeader, 22, content.length);
        writeUint16(localHeader, 26, pathBytes.length);
        writeUint16(localHeader, 28, 0);
        localHeader.set(pathBytes, 30);

        const centralHeader = new Uint8Array(46 + pathBytes.length);
        writeUint32(centralHeader, 0, 0x02014b50);
        writeUint16(centralHeader, 4, 20);
        writeUint16(centralHeader, 6, 20);
        writeUint16(centralHeader, 8, 0);
        writeUint16(centralHeader, 10, 0);
        writeUint16(centralHeader, 12, 0);
        writeUint16(centralHeader, 14, 0);
        writeUint32(centralHeader, 16, crc);
        writeUint32(centralHeader, 20, content.length);
        writeUint32(centralHeader, 24, content.length);
        writeUint16(centralHeader, 28, pathBytes.length);
        writeUint16(centralHeader, 30, 0);
        writeUint16(centralHeader, 32, 0);
        writeUint16(centralHeader, 34, 0);
        writeUint16(centralHeader, 36, 0);
        writeUint32(centralHeader, 38, 0);
        writeUint32(centralHeader, 42, offset);
        centralHeader.set(pathBytes, 46);

        localChunks.push(localHeader, content);
        centralChunks.push(centralHeader);
        offset += localHeader.length + content.length;
    });

    const centralDirectorySize = sumLengths(centralChunks);
    const endOfCentralDirectory = new Uint8Array(22);
    writeUint32(endOfCentralDirectory, 0, 0x06054b50);
    writeUint16(endOfCentralDirectory, 4, 0);
    writeUint16(endOfCentralDirectory, 6, 0);
    writeUint16(endOfCentralDirectory, 8, normalizedEntries.length);
    writeUint16(endOfCentralDirectory, 10, normalizedEntries.length);
    writeUint32(endOfCentralDirectory, 12, centralDirectorySize);
    writeUint32(endOfCentralDirectory, 16, offset);
    writeUint16(endOfCentralDirectory, 20, 0);

    return concatUint8Arrays([...localChunks, ...centralChunks, endOfCentralDirectory]);
}

export function toUint8Array(content: string | Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> | Uint8Array {
    if (typeof content === 'string') {
        return textEncoder.encode(content);
    }

    if (content instanceof Uint8Array) {
        return content;
    }

    if (content instanceof ArrayBuffer) {
        return new Uint8Array(content);
    }

    return content.arrayBuffer().then(buffer => new Uint8Array(buffer));
}

function normalizeArchivePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(sumLengths(chunks));
    let offset = 0;

    chunks.forEach(chunk => {
        result.set(chunk, offset);
        offset += chunk.length;
    });

    return result;
}

function sumLengths(chunks: Uint8Array[]): number {
    return chunks.reduce((total, chunk) => total + chunk.length, 0);
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
    if (!crcTable) {
        crcTable = buildCRCTable();
    }

    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 0xff];
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function buildCRCTable(): Uint32Array {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[index] = value >>> 0;
    }

    return table;
}
