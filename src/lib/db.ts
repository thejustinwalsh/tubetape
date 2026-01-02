import {
  createRxDatabase,
  addRxPlugin,
  toTypedRxJsonSchema,
  type RxDatabase,
  type RxCollection,
  type RxJsonSchema,
  type ExtractDocumentTypeFromTypedRxJsonSchema,
  type RxDocument,
  type RxStorage,
} from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBDevModePlugin, disableWarnings } from "rxdb/plugins/dev-mode";
import { RxDBMigrationPlugin } from "rxdb/plugins/migration-schema";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";

function getStorage(): RxStorage<unknown, unknown> {
  const baseStorage = getRxStorageDexie();
  if (import.meta.env.DEV) {
    addRxPlugin(RxDBDevModePlugin);
    addRxPlugin(RxDBMigrationPlugin);
    disableWarnings();
    return wrappedValidateAjvStorage({ storage: baseStorage });
  }
  addRxPlugin(RxDBMigrationPlugin);
  return baseStorage;
}

const samplesSchemaLiteral = {
  title: "samples schema",
  description: "Audio samples extracted from YouTube videos",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: {
      type: "string",
      maxLength: 100,
    },
    name: {
      type: "string",
      maxLength: 200,
    },
    sourceVideoId: {
      type: "string",
      maxLength: 50,
    },
    sourceVideoTitle: {
      type: "string",
      maxLength: 500,
    },
    sourceAuthorName: {
      type: "string",
      maxLength: 200,
    },
    sourceAuthorUrl: {
      type: "string",
      maxLength: 500,
    },
    sourceAudioPath: {
      type: "string",
      maxLength: 1000,
    },
    startTime: {
      type: "number",
    },
    endTime: {
      type: "number",
    },
    duration: {
      type: "number",
    },
    createdAt: {
      type: "number",
      multipleOf: 1,
      minimum: 0,
      maximum: 9999999999999,
    },
  },
  required: [
    "id",
    "name",
    "sourceVideoId",
    "sourceVideoTitle",
    "sourceAudioPath",
    "startTime",
    "endTime",
    "duration",
    "createdAt",
  ],
  indexes: ["sourceVideoId", "createdAt"],
} as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const schemaTyped = toTypedRxJsonSchema(samplesSchemaLiteral);
export type SampleDocType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof schemaTyped>;
export type SampleDocument = RxDocument<SampleDocType>;
export type SampleCollection = RxCollection<SampleDocType>;

const samplesSchema: RxJsonSchema<SampleDocType> = samplesSchemaLiteral;

export type TubetapeDatabase = RxDatabase<{
  samples: SampleCollection;
}>;

let dbPromise: Promise<TubetapeDatabase> | null = null;

export async function getDatabase(): Promise<TubetapeDatabase> {
  if (!dbPromise) {
    dbPromise = createRxDatabase<{ samples: SampleCollection }>({
      name: "tubetape-v3",
      storage: getStorage(),
      multiInstance: false,
    }).then(async (db) => {
      await db.addCollections({
        samples: {
          schema: samplesSchema,
          migrationStrategies: {
            1: (oldDoc) => {
              oldDoc.sourceAuthorName = "";
              oldDoc.sourceAuthorUrl = "";
              return oldDoc;
            },
          },
        },
      });
      return db;
    });
  }
  return dbPromise;
}

export function generateSampleId(): string {
  return `sample-${crypto.randomUUID()}`;
}
