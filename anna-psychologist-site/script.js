const form = document.querySelector("#booking-form");
const note = document.querySelector("#form-note");
const revealItems = document.querySelectorAll(".reveal");
const carouselButtons = document.querySelectorAll("[data-carousel]");
const contactMethodField = form?.querySelector("[name='contactMethod']");
const contactValueField = form?.querySelector("[name='contactValue']");

const contactPlaceholders = {
  Telegram: "@username",
  Viber: "+380...",
  WhatsApp: "+380...",
  "Телефон": "+380...",
  Email: "name@example.com",
};

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.18,
  }
);

revealItems.forEach((item, index) => {
  item.style.transitionDelay = `${index * 60}ms`;
  observer.observe(item);
});

function syncContactPlaceholder() {
  if (!contactMethodField || !contactValueField) return;

  const placeholder = contactPlaceholders[contactMethodField.value] || "Наприклад, @username, +380..., name@example.com";
  contactValueField.placeholder = placeholder;
}

contactMethodField?.addEventListener("change", syncContactPlaceholder);
syncContactPlaceholder();

carouselButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const track = document.querySelector(`#${button.dataset.carousel}`);
    if (!track) return;

    const card = track.querySelector(".certificate-card");
    const styles = window.getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const step = card ? card.getBoundingClientRect().width + gap : track.clientWidth * 0.9;

    track.scrollBy({
      left: step * Number(button.dataset.direction || 1),
      behavior: "smooth",
    });
  });
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const payload = {
    name: data.get("name")?.toString().trim() || "",
    contactMethod: data.get("contactMethod")?.toString().trim() || "",
    contactValue: data.get("contactValue")?.toString().trim() || "",
    format: data.get("format")?.toString().trim() || "",
    message: data.get("message")?.toString().trim() || "",
    schedule: data.get("schedule")?.toString().trim() || "Не вказано",
  };

  if (!payload.name || !payload.contactMethod || !payload.contactValue || !payload.format || !payload.message) {
    note.textContent = "Будь ласка, заповніть обов'язкові поля перед надсиланням.";
    note.classList.add("is-error");
    note.classList.remove("is-success");
    return;
  }

  const subject = encodeURIComponent(`Заявка на консультацію: ${payload.name}`);
  const body = encodeURIComponent(
    [
      `Ім'я: ${payload.name}`,
      `Спосіб зв'язку: ${payload.contactMethod}`,
      `Контакт: ${payload.contactValue}`,
      `Формат: ${payload.format}`,
      `Зручний час: ${payload.schedule}`,
      "",
      "Запит:",
      payload.message,
    ].join("\n")
  );

  note.textContent = "Поштовий застосунок відкрито. Якщо цього не сталося, напишіть на anna.stryuchenko@gmail.com.";
  note.classList.add("is-success");
  note.classList.remove("is-error");

  window.location.href = `mailto:anna.stryuchenko@gmail.com?subject=${subject}&body=${body}`;
});
