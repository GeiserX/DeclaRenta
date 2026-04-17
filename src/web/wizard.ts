/**
 * Multi-step wizard navigation for DeclaRenta.
 *
 * Manages 3 steps within the Renta section:
 *   1. Upload files (select broker + drag/drop)
 *   2. Review parsed data (summary of what was loaded)
 *   3. Results (casillas, tables, charts, exports)
 */

export type WizardStep = 1 | 2 | 3;

const TOTAL_STEPS = 3;

let currentStep: WizardStep = 1;
let maxReachedStep: WizardStep = 1;
let isInitialRender = true;

type StepChangeCallback = (from: WizardStep, to: WizardStep) => void;
const listeners: StepChangeCallback[] = [];

/** Register a callback for step changes */
export function onStepChange(cb: StepChangeCallback): void {
  listeners.push(cb);
}

/** Get the current wizard step */
export function getCurrentStep(): WizardStep {
  return currentStep;
}

/** Navigate to a specific step (only if reachable) */
export function goToStep(step: WizardStep): void {
  if (step < 1 || step > TOTAL_STEPS) return;
  if (step > maxReachedStep + 1) return; // Can't skip ahead

  const from = currentStep;
  currentStep = step;
  if (step > maxReachedStep) maxReachedStep = step;

  updateDOM();
  for (const cb of listeners) cb(from, step);
}

/** Go to next step */
export function nextStep(): void {
  if (currentStep < TOTAL_STEPS) {
    goToStep((currentStep + 1) as WizardStep);
  }
}

/** Go to previous step */
export function prevStep(): void {
  if (currentStep > 1) {
    goToStep((currentStep - 1) as WizardStep);
  }
}

/** Mark a step as reachable (enables its indicator) */
export function unlockStep(step: WizardStep): void {
  if (step > maxReachedStep) maxReachedStep = step;
  updateProgressIndicator();
}

/** Reset wizard to step 1 */
export function resetWizard(): void {
  currentStep = 1;
  maxReachedStep = 1;
  isInitialRender = true;
  updateDOM();
}

// ---------------------------------------------------------------------------
// DOM updates
// ---------------------------------------------------------------------------

function updateDOM(): void {
  // Show/hide step panels
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const panel = document.getElementById(`wizard-step-${i}`);
    if (panel) {
      panel.hidden = i !== currentStep;
    }
  }

  updateProgressIndicator();

  // Update navigation buttons
  const backBtn = document.getElementById("wizard-back");
  const nextBtn = document.getElementById("wizard-next");
  if (backBtn) {
    backBtn.hidden = currentStep === 1;
  }
  if (nextBtn) {
    nextBtn.hidden = currentStep === TOTAL_STEPS;
  }

  // Scroll to top of wizard (skip on first render to avoid flash)
  if (!isInitialRender) {
    document.getElementById("wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  isInitialRender = false;
}

function updateProgressIndicator(): void {
  const indicators = document.querySelectorAll<HTMLElement>(".wizard-indicator");
  indicators.forEach((el) => {
    const step = parseInt(el.dataset.step ?? "0") as WizardStep;
    el.classList.toggle("active", step === currentStep);
    el.classList.toggle("completed", step < currentStep);
    el.classList.toggle("reachable", step <= maxReachedStep);
  });
}

/** Initialize wizard — call after DOM is ready */
export function initWizard(): void {
  // Progress indicator click handlers
  document.querySelectorAll<HTMLElement>(".wizard-indicator").forEach((el) => {
    el.addEventListener("click", () => {
      const step = parseInt(el.dataset.step ?? "0") as WizardStep;
      if (step <= maxReachedStep) {
        goToStep(step);
      }
    });
  });

  // Navigation buttons
  document.getElementById("wizard-back")?.addEventListener("click", prevStep);
  document.getElementById("wizard-next")?.addEventListener("click", nextStep);

  // Set initial state
  updateDOM();
}
