/* tslint:disable */
/* eslint-disable */

/**
 * Migrate v1 Inky syntax to v2.
 * Returns the migrated HTML string.
 */
export function migrate(html: string): string;

/**
 * Migrate v1 syntax and return a JSON object with `html` and `changes` fields.
 */
export function migrate_with_details(html: string): string;

/**
 * Convert HTML to plain text for multipart email.
 */
export function to_plain_text(html: string): string;

/**
 * Transform Inky HTML into email-safe table markup.
 */
export function transform(html: string): string;

/**
 * Transform using hybrid output mode (div + MSO ghost tables).
 */
export function transform_hybrid(html: string): string;

/**
 * Transform Inky HTML and inline CSS from `<style>` blocks.
 * Falls back to plain transform if inlining fails.
 */
export function transform_inline(html: string): string;

/**
 * Transform with a custom column count.
 */
export function transform_with_config(html: string, column_count: number): string;

/**
 * Transform Inky HTML with MiniJinja data merge, then inline CSS.
 *
 * `data_json` is a JSON string with merge variables.
 * Missing keys render as empty strings (lenient mode).
 * Falls back to plain transform if CSS inlining fails.
 */
export function transform_with_data(html: string, data_json: string): string;

/**
 * Validate an Inky template and return diagnostics as JSON.
 *
 * Returns a JSON array of objects with `severity`, `rule`, and `message` fields.
 */
export function validate(html: string): string;

/**
 * Validate with a custom column count.
 */
export function validate_with_config(html: string, column_count: number): string;

/**
 * Get the Inky version.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly migrate: (a: number, b: number) => [number, number];
    readonly migrate_with_details: (a: number, b: number) => [number, number];
    readonly to_plain_text: (a: number, b: number) => [number, number];
    readonly transform: (a: number, b: number) => [number, number];
    readonly transform_hybrid: (a: number, b: number) => [number, number];
    readonly transform_inline: (a: number, b: number) => [number, number];
    readonly transform_with_config: (a: number, b: number, c: number) => [number, number];
    readonly transform_with_data: (a: number, b: number, c: number, d: number) => [number, number];
    readonly validate: (a: number, b: number) => [number, number];
    readonly validate_with_config: (a: number, b: number, c: number) => [number, number];
    readonly version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
