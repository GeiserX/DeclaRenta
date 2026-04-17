/**
 * Sidebar navigation for DeclaRenta.
 *
 * Hash-based routing between sections: #perfil, #renta, #m720, #d6.
 * Mobile: hamburger toggle with backdrop overlay.
 */

const SECTIONS = ["perfil", "renta", "m720", "d6"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

/** Initialize sidebar navigation */
export function initSidebar(): void {
  document.querySelectorAll<HTMLAnchorElement>(".sidebar-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      if (section && isSection(section)) {
        location.hash = section;
      }
      document.body.classList.remove("sidebar-open");
    });
  });

  window.addEventListener("hashchange", handleHash);

  document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("sidebar-open")) {
      document.body.classList.remove("sidebar-open");
    }
  });

  handleHash();
}

function handleHash(): void {
  const hash = location.hash.slice(1);
  const section: Section = isSection(hash) ? hash : "renta";
  navigateToSection(section);
}

/** Navigate to a section, showing/hiding panels */
export function navigateToSection(section: Section): void {
  for (const s of SECTIONS) {
    const el = document.getElementById(`section-${s}`);
    if (el) {
      el.hidden = s !== section;
      if (s === section) {
        el.classList.remove("fade-in");
        void el.offsetHeight;
        el.classList.add("fade-in");
      }
    }
  }

  document.querySelectorAll<HTMLAnchorElement>(".sidebar-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.section === section);
  });

  if (location.hash !== `#${section}`) {
    history.replaceState(null, "", `#${section}`);
  }
}

/** Update a sidebar badge */
export function updateBadge(section: string, text: string, type?: "success" | "warning"): void {
  const badge = document.getElementById(`badge-${section}`);
  if (!badge) return;
  badge.textContent = text;
  badge.className = "sidebar-badge";
  if (type === "success") badge.classList.add("badge-success");
  else if (type === "warning") badge.classList.add("badge-warning");
}
