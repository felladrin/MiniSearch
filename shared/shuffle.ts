/** Shuffles `items` in place with Fisher-Yates and returns it; every order is equally likely. */
export function shuffle<Item>(items: Item[]): Item[] {
  for (let index = items.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}
