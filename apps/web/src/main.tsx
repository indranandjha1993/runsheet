import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./tokens/tokens.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
