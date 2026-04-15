/**
 * Legal disclaimer modal for DeclaRenta.
 *
 * Opens as a native <dialog> popup triggered from the footer link.
 * Text comes from i18n system.
 */

import { t } from "../i18n/index.js";

let dialog: HTMLDialogElement | null = null;

function renderDialog(): HTMLDialogElement {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "disclaimer-dialog";
    dialog.setAttribute("aria-labelledby", "disclaimer-title");
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog!.close();
    });
    document.body.appendChild(dialog);
  }

  const title = t("disclaimer.title");
  const text = t("disclaimer.text");
  const accept = t("disclaimer.accept");
  const paragraphs = text.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("");

  dialog.innerHTML = `
    <div class="disclaimer-content">
      <h3 id="disclaimer-title">${esc(title)}</h3>
      ${paragraphs}
      <button class="disclaimer-accept" autofocus>${esc(accept)}</button>
    </div>
  `;

  dialog.querySelector(".disclaimer-accept")!.addEventListener("click", () => {
    dialog!.close();
  });

  return dialog;
}

export function openDisclaimer(): void {
  const d = renderDialog();
  d.showModal();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
