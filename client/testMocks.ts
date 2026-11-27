import { useSyncExternalStore } from "react";

/**
 * The `speechToText` mock the dictation component tests share. Each file calls
 * it from its own `vi.mock`, because those calls are hoisted above the
 * imports and only run their factory later.
 */
export async function speechToTextMock() {
  const { DictationError: RealDictationError } = await import(
    "@/modules/speechToText"
  );
  return {
    DictationError: RealDictationError,
    getDictationEngine: vi.fn(() => "wasm" as const),
    startDictation: vi.fn(),
  };
}

/** A `notifications` stub that only records what was shown. */
export function notificationsStub() {
  return { notifications: { show: vi.fn() } };
}

/**
 * `create-pubsub/react` subscribing for real, so a channel written mid-test
 * re-renders the component the way it does in the app.
 */
export function pubSubReactMock() {
  return {
    usePubSub: (pubSub: [unknown, unknown, unknown]) => {
      const [publish, subscribe, get] = pubSub as [
        unknown,
        (listener: () => void) => () => void,
        () => unknown,
      ];
      const value = useSyncExternalStore(subscribe, get, get);
      return [value, publish];
    },
  };
}
