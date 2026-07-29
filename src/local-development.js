import "./local-development.css";

const LOCAL_DEVELOPMENT_TABS = [
  {
    mode: "benchmarks",
    href: "/?mode=benchmarks",
    label: "Benchmarks",
  },
  {
    mode: "calibrate",
    href: "/?mode=calibrate",
    label: "Calibration",
  },
  {
    mode: "analytics",
    href: "/?mode=analytics",
    label: "Reviews",
  },
];

export function isLoopbackHostname(hostname) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function mountLocalDevelopmentNavigation({
  root = document.querySelector("#local-development-root"),
  modeSwitch = document.querySelector(".app-mode-switch"),
  hostname = window.location.hostname,
  currentUrl = new URL(window.location.href),
} = {}) {
  if (!root || !modeSwitch || !isLoopbackHostname(hostname)) {
    return null;
  }

  const labButton = document.createElement("button");
  labButton.type = "button";
  labButton.dataset.localDevelopmentMode = "lab";
  labButton.textContent = "Lab";
  labButton.addEventListener("click", () => {
    window.location.assign("/?mode=benchmarks");
  });
  modeSwitch.append(labButton);

  const navigation = document.createElement("nav");
  navigation.className = "local-development-tabs";
  navigation.setAttribute("aria-label", "Lab");
  const links = LOCAL_DEVELOPMENT_TABS.map(buildTabLink);
  navigation.append(...links);

  root.className = "local-development-root";
  root.replaceChildren(navigation);
  const navigationController = {
    setMode(mode) {
      const activeTab = LOCAL_DEVELOPMENT_TABS.find(
        ({ mode: tabMode }) => tabMode === mode,
      );
      labButton.setAttribute("aria-pressed", String(Boolean(activeTab)));
      root.hidden = !activeTab;
      for (const [index, link] of links.entries()) {
        if (LOCAL_DEVELOPMENT_TABS[index].mode === mode) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      }
    },
  };
  navigationController.setMode(currentUrl.searchParams.get("mode"));
  return navigationController;
}

function buildTabLink(tab) {
  const link = document.createElement("a");
  link.href = tab.href;
  link.textContent = tab.label;
  return link;
}
