import { mock, type Mock } from "bun:test";

/**
 * A Prisma test double. Every `db.<model>.<method>` is created lazily as a Bun mock, so a
 * test only programs the calls it cares about and everything else returns a harmless,
 * shape-correct default (`findMany` → `[]`, `findUnique` → `null`, `updateMany` → `{count:0}`).
 *
 * That default matters: a bare `mock()` resolves `undefined`, which turns an unprogrammed
 * `findMany().map()` into a TypeError that reads like a bug in the code under test.
 */

type AnyMock = Mock<(...args: any[]) => any>;

function defaultFor(method: string): unknown {
  switch (method) {
    case "findMany":
    case "groupBy":
      return [];
    case "findFirst":
    case "findUnique":
    case "findFirstOrThrow":
    case "findUniqueOrThrow":
      return null;
    case "count":
      return 0;
    case "createMany":
    case "updateMany":
    case "deleteMany":
    case "createManyAndReturn":
      return { count: 0 };
    case "aggregate":
      return {};
    default:
      // create / update / upsert / delete
      return {};
  }
}

function createModelMock(): Record<string, AnyMock> {
  const methods = new Map<string, AnyMock>();
  return new Proxy({} as Record<string, AnyMock>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!methods.has(prop)) {
        const fn = mock(async () => defaultFor(prop));
        methods.set(prop, fn as AnyMock);
      }
      return methods.get(prop);
    },
    has() {
      return true;
    },
  });
}

export interface PrismaMock {
  [model: string]: any;
  $transaction: AnyMock;
  $queryRaw: AnyMock;
  $queryRawUnsafe: AnyMock;
  $executeRaw: AnyMock;
  $executeRawUnsafe: AnyMock;
  $disconnect: AnyMock;
}

let models = new Map<string, Record<string, AnyMock>>();

const root: Record<string, AnyMock> = {
  // Interactive form runs the callback against this same mock; array form behaves
  // like Prisma's batch and resolves every promise it was handed.
  $transaction: mock(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(db),
  ) as AnyMock,
  $queryRaw: mock(async () => [{ "?column?": 1 }]) as AnyMock,
  $queryRawUnsafe: mock(async () => []) as AnyMock,
  $executeRaw: mock(async () => 0) as AnyMock,
  $executeRawUnsafe: mock(async () => 0) as AnyMock,
  $disconnect: mock(async () => undefined) as AnyMock,
};

export const db = new Proxy({} as PrismaMock, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    if (prop in root) return root[prop];
    if (!models.has(prop)) models.set(prop, createModelMock());
    return models.get(prop);
  },
  has() {
    return true;
  },
}) as PrismaMock;

/**
 * Drops every programmed model method and its call history. Call in `beforeEach` —
 * a leftover `mockResolvedValue` from a previous test is the classic source of a
 * suite that passes in order and fails in isolation.
 */
export function resetPrismaMock(): void {
  models = new Map();
  for (const fn of Object.values(root)) fn.mockClear();
  root.$transaction.mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(db),
  );
  root.$queryRaw.mockImplementation(async () => [{ "?column?": 1 }]);
}

/** Prisma's unique-constraint failure, for testing the P2002 branches. */
export function uniqueConstraintError(target = "id"): Error & { code: string } {
  const err = new Error(
    `Unique constraint failed on the fields: (\`${target}\`)`,
  ) as Error & { code: string };
  err.code = "P2002";
  return err;
}
