import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "ok" | "err";
interface Item {
  id: number;
  kind: Kind;
  text: string;
}
const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), kind === "err" ? 8000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            {i.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
