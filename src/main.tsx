import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import KusakaLab from "./KusakaLab";
import "./global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Не найден корневой DOM-элемент приложения.");
}

createRoot(root).render(
  <StrictMode>
    <KusakaLab />
  </StrictMode>,
);
