#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DocumentManifestError,
  DocumentParseError,
  parseDocumentManifest,
  type DocumentMediaType,
} from "@points-race/pipeline";

import { parseOfficialDocument } from "./index.js";
import { PdfDocumentError } from "./pdf.js";

type CliExitCode = 0 | 2 | 3;

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, DocumentMediaType>> = {
  ".csv": "text/csv",
  ".htm": "text/html",
  ".html": "text/html",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

class CollectorValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CollectorValidationError";
    this.code = code;
  }
}

interface CliArguments {
  readonly manifestPath: string;
  readonly outputPath: string;
}

export async function runCollectorCli(
  argv: readonly string[],
  writeError: (message: string) => void = (message) =>
    process.stderr.write(message),
): Promise<CliExitCode> {
  let temporaryPath: string | null = null;
  try {
    const args = parseCliArguments(argv);
    const manifestPath = resolve(args.manifestPath);
    const outputPath = resolve(args.outputPath);
    const manifestBytes = readRequiredFile(
      manifestPath,
      "MANIFEST_FILE_NOT_FOUND",
      "MANIFEST_FILE_READ_FAILED",
      "Manifest file is not available as a local file.",
    );
    const manifestText = decodeManifest(manifestBytes);
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestText) as unknown;
    } catch {
      throw new CollectorValidationError(
        "MANIFEST_JSON_INVALID",
        "Manifest file is not valid JSON.",
      );
    }
    const manifest = parseDocumentManifest(manifestValue);
    const sourcePath = resolve(dirname(manifestPath), manifest.sourcePath);
    const mediaType =
      MEDIA_TYPE_BY_EXTENSION[extname(sourcePath).toLowerCase()];
    if (mediaType === undefined || mediaType !== manifest.mediaType) {
      throw new CollectorValidationError(
        "SOURCE_MEDIA_PATH_MISMATCH",
        "Source file extension does not match the manifest media type.",
      );
    }
    assertDistinctOutputPath(outputPath, manifestPath, sourcePath);
    const sourceBytes = readRequiredFile(
      sourcePath,
      "SOURCE_FILE_NOT_FOUND",
      "SOURCE_FILE_READ_FAILED",
      "Source file is not available as a local file.",
    );
    const normalized = await parseOfficialDocument({
      manifest,
      mediaType,
      bytes: sourceBytes,
    });
    const output = `${JSON.stringify(normalized, null, 2)}\n`;
    const parent = dirname(outputPath);
    mkdirSync(parent, { recursive: true });
    temporaryPath = resolve(
      parent,
      `.${basename(outputPath)}.${String(process.pid)}.tmp`,
    );
    const descriptor = openSync(temporaryPath, "wx");
    try {
      writeFileSync(descriptor, output, { encoding: "utf8" });
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, outputPath);
    temporaryPath = null;
    return 0;
  } catch (error) {
    const failure = classifyFailure(error);
    writeError(`${failure.code}: ${failure.message}\n`);
    return failure.exitCode;
  } finally {
    if (temporaryPath !== null && existsSync(temporaryPath)) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // Failure cleanup is best effort; the destination is never touched first.
      }
    }
  }
}

function parseCliArguments(argv: readonly string[]): CliArguments {
  if (argv.length !== 4) {
    throw new CollectorValidationError(
      "CLI_ARGUMENT_INVALID",
      "Expected --manifest <local path> and --output <local path>.",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      (flag !== "--manifest" && flag !== "--output") ||
      value === undefined ||
      value.trim() === "" ||
      values.has(flag) ||
      isRemotePath(value)
    ) {
      throw new CollectorValidationError(
        "CLI_ARGUMENT_INVALID",
        "Expected --manifest <local path> and --output <local path>.",
      );
    }
    values.set(flag, value);
  }
  const manifestPath = values.get("--manifest");
  const outputPath = values.get("--output");
  if (manifestPath === undefined || outputPath === undefined) {
    throw new CollectorValidationError(
      "CLI_ARGUMENT_INVALID",
      "Expected --manifest <local path> and --output <local path>.",
    );
  }
  return { manifestPath, outputPath };
}

function readRequiredFile(
  path: string,
  missingCode: string,
  readCode: string,
  message: string,
): Uint8Array {
  try {
    if (!statSync(path).isFile()) {
      throw new CollectorValidationError(missingCode, message);
    }
    return new Uint8Array(readFileSync(path));
  } catch (error) {
    if (error instanceof CollectorValidationError) throw error;
    if (hasErrorCode(error, "ENOENT")) {
      throw new CollectorValidationError(missingCode, message);
    }
    throw new CollectorValidationError(readCode, message);
  }
}

function decodeManifest(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new CollectorValidationError(
      "MANIFEST_ENCODING_INVALID",
      "Manifest must use UTF-8 without a byte-order mark.",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CollectorValidationError(
      "MANIFEST_ENCODING_INVALID",
      "Manifest must contain valid UTF-8 text.",
    );
  }
}

function assertDistinctOutputPath(
  outputPath: string,
  manifestPath: string,
  sourcePath: string,
): void {
  const outputIdentity = pathIdentity(outputPath);
  if (
    outputIdentity === pathIdentity(manifestPath) ||
    outputIdentity === pathIdentity(sourcePath)
  ) {
    throw new CollectorValidationError(
      "OUTPUT_PATH_CONFLICT",
      "Output path must differ from the manifest and source paths.",
    );
  }
}

function pathIdentity(path: string): string {
  let resolved = resolve(path);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // A new output path has no real path yet; its resolved path is sufficient.
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isRemotePath(value: string): boolean {
  if (/^(?:https?|file|data):/i.test(value) || /^[/\\]{2}/.test(value)) {
    return true;
  }
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function classifyFailure(error: unknown): {
  readonly exitCode: 2 | 3;
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof CollectorValidationError) {
    return { exitCode: 2, code: error.code, message: error.message };
  }
  if (error instanceof DocumentManifestError) {
    return { exitCode: 2, code: error.code, message: error.message };
  }
  if (error instanceof DocumentParseError) {
    return {
      exitCode: error.code === "DOCUMENT_MEDIA_TYPE_MISMATCH" ? 2 : 3,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof PdfDocumentError) {
    return { exitCode: 3, code: error.code, message: error.message };
  }
  return {
    exitCode: 3,
    code: "COLLECTOR_INTERNAL_ERROR",
    message: "Document collection failed safely.",
  };
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathIdentity(entryPath) === pathIdentity(fileURLToPath(import.meta.url))
) {
  runCollectorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
