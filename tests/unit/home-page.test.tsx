// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import HomePage from "@/app/page";

function renderHome() {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<HomePage />);
  return container;
}

it("presents exactly two primary product experiences under the shared-data hero", () => {
  const container = renderHome();
  expect(container.querySelector("h1")?.textContent).toBe("Hai trải nghiệm, một nền dữ liệu");
  const cards = Array.from(container.querySelectorAll("a.experience-card"));
  expect(cards.map((card) => [card.querySelector("strong")?.textContent, card.getAttribute("href")])).toEqual([
    ["Ứng dụng nhân viên", "/login?callbackUrl=/staff"], ["Kiosk khách hàng", "/kiosk"],
  ]);
});

it("keeps Admin and printable ESL labels available as compact secondary links", () => {
  const container = renderHome();
  const links = Array.from(container.querySelectorAll('nav[aria-label="Demo bổ trợ"] a'));
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Backoffice quản trị", "/login?callbackUrl=/admin"], ["Nhãn ESL demo", "/demo/esl-labels"],
  ]);
  expect(links.every((link) => !link.classList.contains("experience-card"))).toBe(true);
  expect(container.querySelector(".data-flow")).toBeNull();
});
