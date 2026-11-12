/**
 * Branded primitives so a block height, a transaction index, and a ticket index
 * can never be passed where one of the others is expected.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type BlockHeight = Brand<number, "BlockHeight">;
export type TxId = Brand<string, "TxId">;
export type TicketIndex = Brand<number, "TicketIndex">;

export function blockHeight(value: number): BlockHeight {
  return value as BlockHeight;
}

export function txId(value: string): TxId {
  return value as TxId;
}

export function ticketIndex(value: number): TicketIndex {
  return value as TicketIndex;
}
