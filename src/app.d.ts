// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// File System Access API — the file pickers and the per-handle permission
	// calls are not in TypeScript's DOM lib yet, and are missing entirely in
	// some browsers (mobile Safari), hence the optional members.
	interface FileSystemHandlePermissionDescriptor {
		mode?: 'read' | 'readwrite';
	}

	interface FilePickerAcceptType {
		description?: string;
		accept: Record<string, string[]>;
	}

	interface FilePickerOptions {
		types?: FilePickerAcceptType[];
		excludeAcceptAllOption?: boolean;
		/** Remembers the directory the picker last opened at, per id. */
		id?: string;
		startIn?: FileSystemHandle | string;
	}

	interface SaveFilePickerOptions extends FilePickerOptions {
		suggestedName?: string;
	}

	interface OpenFilePickerOptions extends FilePickerOptions {
		multiple?: boolean;
	}

	interface FileSystemHandle {
		queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
		requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
	}

	interface Window {
		showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
		showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
	}
}

export {};
