export const FILE_STORAGE = Symbol('FILE_STORAGE');

export type StoredFile = { key: string };
export type DownloadedFile = { body: Buffer; contentType: string };

export interface FileStorage {
  upload(input: {
    key: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredFile>;
  download(key: string): Promise<DownloadedFile>;
  downloadUrl?(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
