export type TestPushArrivalEvent = {
  testId?: string | undefined;
  receivedAt: string;
};

type TestPushArrivalListener = (event: TestPushArrivalEvent) => void;

const listeners = new Set<TestPushArrivalListener>();

export function emitTestPushArrival(event: TestPushArrivalEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // ignore subscriber errors so one bad listener cannot break others
    }
  }
}

export function onTestPushArrival(
  listener: TestPushArrivalListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
