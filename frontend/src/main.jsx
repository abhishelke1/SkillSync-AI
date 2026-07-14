/*
=== PURPOSE ===
Entry point of the React application.

=== WHY IT EXISTS ===
React needs a root file that mounts the App component into the HTML page.

=== HOW IT CONNECTS ===
- index.html has a <div id="root"> — this file renders App inside it
- Imports App.jsx which contains the entire UI
*/

import { StrictMode } from "react";          // Helps catch bugs during development
import { createRoot } from "react-dom/client"; // React 18+ rendering API
import App from "./App.jsx";                   // Our single-page application component

// Find the <div id="root"> in index.html and render our App inside it
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
