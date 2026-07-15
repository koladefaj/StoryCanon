"use client";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.25V3M8 13v1.75M1.25 8H3M13 8h1.75M3.23 3.23l1.24 1.24M11.53 11.53l1.24 1.24M12.77 3.23l-1.24 1.24M4.47 11.53l-1.24 1.24" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    >
      <path d="M13.25 9.6A5.9 5.9 0 1 1 6.4 2.75a4.7 4.7 0 0 0 6.85 6.85z" />
    </svg>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem("storycanon-theme", next);
    } catch {
      // Theme still applies for this visit even if storage is unavailable.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {/* CSS decides which icon is visible, so server and client render the same markup. */}
      <span className="theme-icon-moon">
        <MoonIcon />
      </span>
      <span className="theme-icon-sun">
        <SunIcon />
      </span>
    </button>
  );
}
