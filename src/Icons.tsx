import type { ReactNode } from "react";

const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;
const wrap = (d: ReactNode) => () => <svg {...base}>{d}</svg>;

export const IconHome = wrap(<path d="M12 3 2.5 11.5h2.7V20h5.1v-5.6h3.4V20h5.1v-8.5h2.7z" />);
export const IconLoader = wrap(<path d="M12 3a1 1 0 0 1 1 1v8.6l2.8-2.8 1.4 1.4-5.2 5.2-5.2-5.2 1.4-1.4 2.8 2.8V4a1 1 0 0 1 1-1zM4 18h16v3H4z" />);
export const IconMods = wrap(<path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm11.5 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />);
export const IconLogs = wrap(<path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 1.5V8h4.5zM8 12h8v1.6H8zm0 3.5h8v1.6H8z" />);
export const IconSettings = wrap(<path d="M10.3 2h3.4l.5 2.6 1.6.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.6 2.6.5v3.4l-2.6.5-.7 1.6 1.5 2.2-2.4 2.4-2.2-1.5-1.6.7-.5 2.6h-3.4l-.5-2.6-1.6-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.6L2 13.7v-3.4l2.6-.5.7-1.6-1.5-2.2 2.4-2.4 2.2 1.5 1.6-.7zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />);
export const IconFolder = wrap(<path d="M3 5h6.5l2 2.5H21a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />);
export const IconSearch = wrap(<path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" />);
export const IconPlay = wrap(<path d="M7 4.5v15l12-7.5z" />);
export const IconDoc = wrap(<path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 1.5V8h4.5z" />);
