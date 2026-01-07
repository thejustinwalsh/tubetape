/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VERBOSE_LOGGING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
