(() => {
  const storageKey = "open-projects.language";
  const simplifiedChineseSubtags = new Set(["hans", "cn", "sg", "my"]);
  const languageMenu = document.querySelector("[data-language-menu]");
  const languageTrigger = languageMenu?.querySelector("summary");
  const languageIndicator = languageMenu?.querySelector("[data-language-indicator]");
  const languageChoices = languageMenu?.querySelectorAll("[data-language-choice]") ?? [];
  const translations = [];

  for (const [source, target] of [
    ["data-zh-cn", null],
    ["data-zh-cn-aria-label", "aria-label"],
    ["data-zh-cn-content", "content"],
    ["data-zh-cn-alt", "alt"],
  ]) {
    for (const element of document.querySelectorAll(`[${source}]`)) {
      translations.push({
        element,
        target,
        english: target ? element.getAttribute(target) : element.textContent,
        chinese: element.getAttribute(source),
      });
    }
  }

  function browserLanguage() {
    const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];

    for (const preference of preferences) {
      if (!preference) continue;

      const [language, subtag] = preference.toLowerCase().split("-");
      if (language === "en") return "en";
      if (language === "zh" && (!subtag || simplifiedChineseSubtags.has(subtag))) return "zh-CN";
    }

    return "en";
  }

  function applyLanguage(choice) {
    const language = choice === "auto" ? browserLanguage() : choice;
    document.documentElement.lang = language;

    for (const { element, target, english, chinese } of translations) {
      const value = language === "zh-CN" ? chinese : english;
      if (target) {
        element.setAttribute(target, value);
      } else {
        element.textContent = value;
      }
    }

    if (languageIndicator) {
      languageIndicator.lang = language;
      languageIndicator.textContent = language === "zh-CN" ? "简中" : "EN";
    }

    for (const option of languageChoices) {
      option.setAttribute("aria-pressed", String(option.dataset.languageChoice === choice));
    }
  }

  let choice = "auto";
  try {
    const savedLanguage = localStorage.getItem(storageKey);
    if (savedLanguage === "en" || savedLanguage === "zh-CN") choice = savedLanguage;
  } catch {
    // Storage may be disabled by the browser.
  }

  applyLanguage(choice);

  if (!languageTrigger) return;

  languageMenu.hidden = false;

  function closeLanguageMenu() {
    languageMenu.open = false;
    languageTrigger.focus();
  }

  for (const option of languageChoices) {
    option.addEventListener("click", () => {
      const selected = option.dataset.languageChoice;
      applyLanguage(selected);
      closeLanguageMenu();

      try {
        if (selected === "auto") {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, selected);
        }
      } catch {
        // The selected language still applies to this page.
      }
    });
  }

  languageMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && languageMenu.open) {
      event.preventDefault();
      closeLanguageMenu();
    }
  });

  languageMenu.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !languageMenu.contains(event.relatedTarget)) {
      languageMenu.open = false;
    }
  });

  document.addEventListener("click", (event) => {
    if (languageMenu.open && !languageMenu.contains(event.target)) {
      languageMenu.open = false;
    }
  });
})();
