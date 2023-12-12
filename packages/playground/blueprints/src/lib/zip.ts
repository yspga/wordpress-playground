import { Semaphore } from '@php-wasm/util';

export interface ZipFileHeader {
	startsAt?: number;
	extract?: any;
	signature: string;
	version: number;
	generalPurpose: number;
	compressionMethod: number;
	lastModifiedTime: number;
	lastModifiedDate: number;
	crc: number;
	compressedSize: number;
	uncompressedSize: number;
	fileNameLength: number;
	fileName: string;
	extraLength: number;
	extra: Uint8Array;
}

export interface ZipFileEntry extends ZipFileHeader {
	dataStream: ReadableStream<Uint8Array>;
	text(): Promise<string>;
	bytes(): Promise<Uint8Array>;
}

const FILE_HEADER_SIZE = 32;
const SIGNATURE_FILE = 0x04034b50;
const SIGNATURE_CENTRAL_DIRECTORY_START = 0x02014b50;
const SIGNATURE_CENTRAL_DIRECTORY_END = 0x06054b50;

interface CentralDirectoryEntry {
	versionCreated: number;
	versionNeeded: number;
	generalPurpose: number;
	compressionMethod: number;
	lastModifiedTime: number;
	lastModifiedDate: number;
	crc: number;
	compressedSize: number;
	uncompressedSize: number;
	fileNameLength: number;
	extraLength: number;
	fileCommentLength: number;
	diskNumber: number;
	internalAttributes: number;
	externalAttributes: number;
	offset: number;
	fileName: string;
	extra: Uint8Array;
	fileComment: string;
}

async function readCentralDirectory(
	stream: ReadableStream<Uint8Array>,
	skipSignature = false
): Promise<CentralDirectoryEntry | null> {
	if (!skipSignature) {
		const signature = await readUint32(stream);
		if (signature !== SIGNATURE_CENTRAL_DIRECTORY_START) {
			return null;
		}
	}
	const data = await pullBytesAsDataView(stream, 42);
	const centralDirectory: Partial<CentralDirectoryEntry> = {
		versionCreated: data.getUint16(0, true),
		versionNeeded: data.getUint16(2, true),
		generalPurpose: data.getUint16(4, true),
		compressionMethod: data.getUint16(6, true),
		lastModifiedTime: data.getUint16(8, true),
		lastModifiedDate: data.getUint16(10, true),
		crc: data.getUint32(12, true),
		compressedSize: data.getUint32(16, true),
		uncompressedSize: data.getUint32(20, true),
		fileNameLength: data.getUint16(24, true),
		extraLength: data.getUint16(26, true),
		fileCommentLength: data.getUint16(28, true),
		diskNumber: data.getUint16(30, true),
		internalAttributes: data.getUint16(32, true),
		externalAttributes: data.getUint32(34, true),
		offset: data.getUint32(38, true),
	};
	centralDirectory['fileName'] = (
		await pullBytes(stream, centralDirectory.fileNameLength!)
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(concatString())
			.getReader()
			.read()
	).value;
	centralDirectory['extra'] = (
		await pullBytes(stream, centralDirectory.extraLength!)
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(concatString())
			.getReader()
			.read()
	).value;
	centralDirectory['fileComment'] = (
		await pullBytes(stream, centralDirectory.fileCommentLength!)
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(concatString())
			.getReader()
			.read()
	).value;
	return centralDirectory as CentralDirectoryEntry;
}

async function readFileHeader(
	stream: ReadableStream<Uint8Array>,
	skipSignature = false
): Promise<ZipFileHeader> {
	if (!skipSignature) {
		const signature = await readUint32(stream);
		if (signature !== SIGNATURE_FILE) {
			throw new Error('Invalid signature');
		}
	}
	const data = await pullBytesAsDataView(stream, 26);
	const entry: Partial<ZipFileEntry> = {};
	entry['version'] = data.getUint32(0, true);
	entry['generalPurpose'] = data.getUint16(2, true);
	entry['compressionMethod'] = data.getUint16(4, true);
	entry['lastModifiedTime'] = data.getUint16(6, true);
	entry['lastModifiedDate'] = data.getUint16(8, true);
	entry['crc'] = data.getUint32(10, true);
	entry['compressedSize'] = data.getUint32(14, true);
	entry['uncompressedSize'] = data.getUint32(18, true);
	entry['fileNameLength'] = data.getUint16(22, true);
	entry['extraLength'] = data.getUint16(24, true);
	entry['fileName'] = await pullBytes(stream, entry['fileNameLength'])
		.pipeThrough(new TextDecoderStream())
		.pipeThrough(concatString())
		.getReader()
		.read()
		.then(({ value }) => value);
	entry['extra'] = await pullBytes(stream, entry['extraLength'])
		.pipeThrough(concatBytes(entry['extraLength']))
		.getReader()
		.read()
		.then(({ value }) => value);
	console.log({ entry });
	return entry as ZipFileHeader;
}

const sem = new Semaphore({ concurrency: 10 });
async function* fetchZipFiles(
	source: RangeGetter,
	zipEntries: CentralDirectoryEntry[]
) {
	const chunks = [];
	let bufferedEntries: CentralDirectoryEntry[] = [];
	let lastOffset = 0;
	for (const zipEntry of zipEntries) {
		const currentOffset = zipEntry.offset!;
		if (lastOffset > currentOffset + 10 * 1024) {
			chunks.push(fetchFilesChunk(source, bufferedEntries));
			bufferedEntries = [];
		}
		lastOffset = currentOffset;
		bufferedEntries.push(zipEntry);
	}
	chunks.push(fetchFilesChunk(source, bufferedEntries));

	for (const chunk of chunks) {
		for await (const file of chunk) {
			yield file;
		}
	}
}

async function* fetchFilesChunk(
	source: RangeGetter,
	zipEntries: CentralDirectoryEntry[]
) {
	console.log('chunks', zipEntries);

	if (!zipEntries.length) {
		return;
	}

	const release = await sem.acquire();
	try {
		const lastZipEntry = zipEntries[zipEntries.length - 1];
		const fileStream = await source.readStream(
			zipEntries[0].offset!,
			lastZipEntry.offset! +
				FILE_HEADER_SIZE +
				lastZipEntry.fileNameLength +
				lastZipEntry.extraLength +
				lastZipEntry.fileCommentLength +
				lastZipEntry.compressedSize -
				1
		);

		while (true) {
			const header = await readFileHeader(fileStream, false);
			const fileDataStream = createFileDataStream(fileStream, header);

			const isOneOfRequestedFiles = zipEntries.find(
				(entry) => entry.fileName === header.fileName
			);
			if (isOneOfRequestedFiles) {
				yield {
					...header,
					dataStream: fileDataStream,
				} as ZipFileEntry;
			}
		}
	} finally {
		release();
	}
}

interface CentralDirectoryEndEntry {
	numberOfDisks: number;
	centralDirectoryStartDisk: number;
	numberCentralDirectoryRecordsOnThisDisk: number;
	numberCentralDirectoryRecords: number;
	centralDirectorySize: number;
	centralDirectoryOffset: number;
	commentLength: number;
	comment: string;
}

async function findCentralDirectoryOffset(source: RangeGetter) {
	const chunkSize = 1024; // Size of each chunk to scan, adjust as needed

	// Scan from the end using Byte Range headers
	let previousChunk: DataView | null = null;
	for (
		let start = source.length - chunkSize;
		start >= 0;
		start -= chunkSize
	) {
		const end = Math.min(start + chunkSize - 1, source.length - 1);
		const view = await source.read(start, end);

		// Scan the buffer for the signature
		for (let i = 0; i < view.byteLength - 4; i++) {
			if (view.getUint32(i, true) === SIGNATURE_CENTRAL_DIRECTORY_END) {
				let bothChunks: Uint8Array;
				if (previousChunk) {
					bothChunks = new Uint8Array(
						previousChunk!.buffer.byteLength + view.byteLength
					);
					bothChunks.set(new Uint8Array(view.buffer));
					bothChunks.set(
						new Uint8Array(previousChunk!.buffer),
						view!.byteLength
					);
				} else {
					bothChunks = new Uint8Array(view.buffer);
				}

				const centralDirectorySizeAt = i + 4 + 2 + 2 + 2 + 2;
				const centralDirectoryOffsetAt = centralDirectorySizeAt + 4;
				if (bothChunks.byteLength < centralDirectoryOffsetAt + 4) {
					throw new Error('Central directory not found');
				}
				return {
					offset: view.getUint32(centralDirectoryOffsetAt, true),
					size: view.getUint32(centralDirectorySizeAt, true),
				};
			}
		}
		previousChunk = view;
	}

	throw new Error('Central directory not found');
}

async function readEndCentralDirectory(stream: ReadableStream<Uint8Array>) {
	const endOfDirectory: Partial<CentralDirectoryEndEntry> = {
		numberOfDisks: await readUint16(stream),
		centralDirectoryStartDisk: await readUint16(stream),
		numberCentralDirectoryRecordsOnThisDisk: await readUint16(stream),
		numberCentralDirectoryRecords: await readUint16(stream),
		centralDirectorySize: await readUint32(stream),
		centralDirectoryOffset: await readUint32(stream),
		commentLength: await readUint16(stream),
	};
	endOfDirectory['comment'] = await pullBytes(
		stream,
		endOfDirectory.commentLength!
	)
		.pipeThrough(new TextDecoderStream())
		.pipeThrough(concatString())
		.getReader()
		.read()
		.then(({ value }) => value);
	return endOfDirectory as CentralDirectoryEndEntry;
}

function createFileDataStream(
	stream: ReadableStream<Uint8Array>,
	header: ZipFileHeader
): ReadableStream<Uint8Array> {
	if (header.compressedSize === 0) {
		return new ReadableStream({
			start(controller) {
				controller.close();
			},
		});
	}

	const bytesStream = pullBytes(stream, header.compressedSize);
	if (header.compressionMethod === 0) {
		return bytesStream;
	}
	return bytesStream.pipeThrough(new DecompressionStream('deflate-raw'));
}

export async function concatBytesStream(
	stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
	let size = 0;
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		chunks.push(value);
		size += value.length;
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function concatString() {
	const chunks: string[] = [];
	return new TransformStream({
		transform(chunk) {
			console.log('chunk', chunk);
			chunks.push(chunk);
		},

		flush(controller) {
			controller.enqueue(chunks.join(''));
		},
	});
}

function concatBytes(totalBytes?: number) {
	const buffer = new ArrayBuffer(totalBytes || 0);
	let offset = 0;
	return new TransformStream({
		transform(chunk) {
			const view = new Uint8Array(buffer);
			view.set(chunk, offset);
			offset += chunk.length;
		},

		flush(controller) {
			console.log('flush', buffer);
			controller.enqueue(new Uint8Array(buffer));
		},
	});
}

export function iterateZipFiles() {}
async function* listZipFiles(source: RangeGetter) {
	const { size, offset } = await findCentralDirectoryOffset(source);
	const stream = await source.readStream(offset, offset + size);
	while (true) {
		const entry = await readCentralDirectory(stream);
		if (!entry) {
			break;
		}
		yield entry;
	}
}

type RangeGetter = {
	length: number;
	read: (start: number, end: number) => Promise<DataView>;
	readStream: (
		start: number,
		end: number
	) => Promise<ReadableStream<Uint8Array>>;
};

async function fetchBytes(url: string): Promise<RangeGetter> {
	const response = await fetch(url, { method: 'HEAD' });
	if (!response.ok) throw new Error('Failed to fetch the ZIP file');

	const contentLength = response.headers.get('Content-Length');
	if (!contentLength) throw new Error('Content-Length header is missing');

	const read = async (from: number, to: number) =>
		await fetch(url, {
			headers: {
				Range: `bytes=${from}-${to}`,
				'Accept-Encoding': 'none',
			},
		})
			.then((response) => response.arrayBuffer())
			.then((buffer) => new DataView(buffer));

	const readStream = async (from: number, to: number) =>
		await fetch(url, {
			headers: {
				Range: `bytes=${from}-${to}`,
				'Accept-Encoding': 'none',
			},
		}).then((response) => response.body!);

	return {
		read,
		readStream,
		length: parseInt(contentLength, 10),
	};
}

async function readUint32(stream: ReadableStream<Uint8Array>) {
	return (await pullBytesAsDataView(stream, 4)).getUint32(0, true);
}

async function readUint16(stream: ReadableStream<Uint8Array>) {
	return (await pullBytesAsDataView(stream, 2)).getUint16(0, true);
}

async function pullBytesAsDataView(
	stream: ReadableStream<Uint8Array>,
	bytes: number
) {
	return await pullBytes(stream, bytes)
		.getReader()
		.read()
		.then(({ value }) => new DataView(value.buffer));
}

function pullBytes(stream: ReadableStream<Uint8Array>, bytes: number) {
	if (bytes === 0) {
		return new ReadableStream({
			start(controller) {
				controller.close();
			},
		});
	}
	// const buffer = new ArrayBuffer(bytes);
	const reader = stream.getReader({ mode: 'byob' });
	let offset = 0;
	console.log(bytes - offset);
	return new ReadableStream({
		async pull(controller) {
			const { value, done } = await reader.read(
				new Uint8Array(bytes - offset)
			);
			if (done) {
				reader.releaseLock();
				controller.close();
				return;
			}
			offset += value.length;
			controller.enqueue(value);

			if (offset >= bytes) {
				reader.releaseLock();
				controller.close();
			}
		},
		cancel() {
			reader.cancel();
		},
	});
}

const source = await fetchBytes(
	'https://downloads.wordpress.org/plugin/classic-editor.latest-stable.zip'
	// 'https://github.com/Automattic/themes/archive/refs/heads/trunk.zip'
	// 'https://downloads.wordpress.org/plugin/gutenberg.latest-stable.zip'
	// 'https://wordpress.org/nightly-builds/wordpress-latest.zip'
);

const entries: CentralDirectoryEntry[] = [];
for await (const zipEntry of listZipFiles(source)) {
	if (
		// !zipEntry.fileName.includes('gutenberg/lib/experimental') &&
		// !zipEntry.fileName.includes('gutenberg/README.md')
		false
	) {
		continue;
	}
	if (zipEntry.fileName.endsWith('/') || zipEntry.uncompressedSize === 0) {
		continue;
	}
	entries.push(zipEntry);
}

for await (const file of fetchZipFiles(source, entries)) {
	console.log(file.fileName);
}

throw new Error('Expected halt');

/*

const source = await fetchBytes(
	'https://downloads.wordpress.org/plugin/classic-editor.latest-stable.zip'
);

const stream = await source.readStream(0, 25000);
async function __readEntry() {
	console.log((await readUint32(stream)) === SIGNATURE_FILE);
	const header = await readFileHeader(stream);
	console.log(header);
	if (header.compressedSize > 0) {
		const { value } = await pullBytes(stream, header.compressedSize)
			.pipeThrough(new DecompressionStream('deflate-raw'))
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(concatString())
			.getReader()
			.read();
		console.log({ value });
	}
}

await __readEntry();
await __readEntry();

throw new Error('Expected halt');
*/

// const file = await readFileHeader(
// 	await this.source.readStream(
// 		dirEntry.offset,
// 		dirEntry.compressedSize
// 	)
// );
