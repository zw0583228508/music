/**
 * Local-filesystem object storage backend for local development.
 *
 * The production deployment uses Replit Object Storage (GCS `external_account`
 * via the Replit sidecar). That backend is unavailable off-Replit, so this
 * module provides a structural drop-in for the small slice of the
 * `@google-cloud/storage` surface that `objectStorage.ts` actually uses:
 *
 *   storage.bucket(name).file(name)            -> LocalFile
 *   bucket.getFiles({ prefix })                -> [LocalFile[]]
 *   bucket.deleteFiles({ prefix, force })
 *   file.name / exists() / download() / save()
 *   file.createReadStream({ start, end }?) / createWriteStream({ metadata })
 *   file.getMetadata() / delete({ ignoreNotFound })
 *
 * It is only selected when `MUSIC_OBJECT_STORAGE_DRIVER === "local"`; the
 * production path never imports it.
 */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Writable } from "node:stream";

type SaveMetadata = {
  contentType?: string;
  cacheControl?: string;
};

type CreateWriteStreamOptions = {
  resumable?: boolean;
  metadata?: SaveMetadata;
};

type CreateReadStreamOptions = {
  start?: number;
  end?: number;
};

type FileMetadata = {
  contentType?: string;
  cacheControl?: string;
  size: number;
  timeCreated?: string;
  updated?: string;
};

const META_SUFFIX = ".objectmeta.json";

function sidecarPath(absolutePath: string): string {
  return `${absolutePath}${META_SUFFIX}`;
}

/** Reject `..` traversal and absolute segments before touching the disk. */
function safeJoin(root: string, ...segments: string[]): string {
  const target = resolve(root, join(...segments));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error("Local object path escapes the storage root");
  }
  return target;
}

class LocalFile {
  constructor(
    private readonly root: string,
    /** Object name within the bucket, POSIX-style (matches GCS `file.name`). */
    readonly name: string,
  ) {}

  private get absolutePath(): string {
    return safeJoin(this.root, ...this.name.split("/"));
  }

  async exists(): Promise<[boolean]> {
    try {
      await stat(this.absolutePath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[FileMetadata]> {
    const absolutePath = this.absolutePath;
    const stats = await stat(absolutePath);
    let sidecar: SaveMetadata = {};
    try {
      sidecar = JSON.parse(
        await readFile(sidecarPath(absolutePath), "utf8"),
      ) as SaveMetadata;
    } catch {
      // No sidecar: fall back to bare filesystem facts.
    }
    return [
      {
        contentType: sidecar.contentType,
        cacheControl: sidecar.cacheControl,
        size: stats.size,
        timeCreated: stats.birthtime.toISOString(),
        updated: stats.mtime.toISOString(),
      },
    ];
  }

  async download(): Promise<[Buffer]> {
    return [await readFile(this.absolutePath)];
  }

  createReadStream(options: CreateReadStreamOptions = {}): Readable {
    const range =
      options.start !== undefined || options.end !== undefined
        ? { start: options.start ?? 0, end: options.end }
        : undefined;
    return createReadStream(this.absolutePath, range);
  }

  createWriteStream(options: CreateWriteStreamOptions = {}): Writable {
    const absolutePath = this.absolutePath;
    mkdirSync(dirname(absolutePath), { recursive: true });
    const fileStream = createWriteStream(absolutePath);
    if (options.metadata) {
      const metadata = options.metadata;
      fileStream.once("finish", () => {
        void writeFile(
          sidecarPath(absolutePath),
          JSON.stringify(metadata),
        ).catch(() => {});
      });
    }
    return fileStream;
  }

  async save(
    data: Buffer | string,
    options: CreateWriteStreamOptions = {},
  ): Promise<void> {
    const absolutePath = this.absolutePath;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, data);
    if (options.metadata) {
      await writeFile(
        sidecarPath(absolutePath),
        JSON.stringify(options.metadata),
      );
    }
  }

  async delete(options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    const absolutePath = this.absolutePath;
    try {
      await rm(absolutePath);
    } catch (error) {
      if (!options.ignoreNotFound) throw error;
    }
    await rm(sidecarPath(absolutePath), { force: true });
  }
}

type GetFilesOptions = { prefix?: string };
type DeleteFilesOptions = { prefix?: string; force?: boolean };

class LocalBucket {
  constructor(
    private readonly root: string,
    private readonly bucketName: string,
  ) {}

  private get bucketRoot(): string {
    return safeJoin(this.root, this.bucketName);
  }

  file(name: string): LocalFile {
    return new LocalFile(this.bucketRoot, name);
  }

  async getFiles(options: GetFilesOptions = {}): Promise<[LocalFile[]]> {
    const bucketRoot = this.bucketRoot;
    if (!existsSync(bucketRoot)) return [[]];
    const prefix = options.prefix ?? "";
    const found: LocalFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (entry.name.endsWith(META_SUFFIX)) continue;
        const objectName = relative(bucketRoot, absolute).split(sep).join("/");
        if (objectName.startsWith(prefix)) {
          found.push(new LocalFile(bucketRoot, objectName));
        }
      }
    };
    await walk(bucketRoot);
    return [found];
  }

  async deleteFiles(options: DeleteFilesOptions = {}): Promise<void> {
    const [files] = await this.getFiles({ prefix: options.prefix });
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
    }
  }
}

export type LocalStorage = {
  bucket(name: string): LocalBucket;
};

export function createLocalStorage(rootDir: string): LocalStorage {
  const root = resolve(rootDir);
  mkdirSync(root, { recursive: true });
  return {
    bucket(name: string): LocalBucket {
      return new LocalBucket(root, name);
    },
  };
}
