export function assertCondition(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertSequenceInOrder(actual: string[], expected: string[], label: string): void {
  let cursor = 0;
  for (const item of expected) {
    const index = actual.indexOf(item, cursor);
    if (index === -1) {
      throw new Error(`${label}: missing event in order: ${item}`);
    }
    cursor = index + 1;
  }
}
