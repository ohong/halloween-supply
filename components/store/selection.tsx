"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CostumeView, PieceView, ProductOption } from "@/lib/types";

// Which option (default or alternative) is selected for each piece. Shared by the
// carousel, the piece list and add-to-cart. Defaults to rank 0 (options[0]).

interface SelectionApi {
  view: CostumeView;
  selectedOption: (piece: PieceView) => ProductOption;
  select: (pieceId: string, productId: string) => void;
  /** The piece whose slide the carousel should show; `nonce` re-triggers for the same piece. */
  focus: { pieceId: string; nonce: number } | null;
  focusPiece: (pieceId: string) => void;
}

const SelectionContext = createContext<SelectionApi | null>(null);

export function SelectionProvider({ view, children }: { view: CostumeView; children: ReactNode }) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<SelectionApi["focus"]>(null);

  const selectedOption = useCallback(
    (piece: PieceView) => piece.options.find((o) => o.product.id === chosen[piece.piece.id]) ?? piece.options[0],
    [chosen],
  );
  const focusPiece = useCallback((pieceId: string) => setFocus((f) => ({ pieceId, nonce: (f?.nonce ?? 0) + 1 })), []);
  const select = useCallback((pieceId: string, productId: string) => {
    setChosen((c) => ({ ...c, [pieceId]: productId }));
    focusPiece(pieceId);
  }, [focusPiece]);

  const value = useMemo(() => ({ view, selectedOption, select, focus, focusPiece }), [view, selectedOption, select, focus, focusPiece]);
  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function useSelection(): SelectionApi {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>");
  return ctx;
}
