// Builds the sidebar from every <section class="page-section"> on the page, using its
// <h2> as the link text, and highlights the section currently in view.
const section_nav = document.getElementById("section-nav");
const page_sections = Array.from(document.querySelectorAll(".page-section"));

const nav_links = page_sections.map((sec) => {
    const a = document.createElement("a");
    a.href = "#" + sec.id;
    a.textContent = sec.querySelector("h2")?.textContent || sec.id;
    section_nav.appendChild(a);
    return a;
});

let active_index = -1;
function set_active(index) {
    if (index === active_index) return;
    active_index = index;
    nav_links.forEach((a, i) => {
        if (i === index) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
    });
    // On narrow screens the nav scrolls horizontally: keep the active tab in view without touching page scroll
    const active_link = nav_links[index];
    if (active_link && section_nav.scrollWidth > section_nav.clientWidth) {
        const left = active_link.offsetLeft;
        const right = left + active_link.offsetWidth;
        if (left < section_nav.scrollLeft || right > section_nav.scrollLeft + section_nav.clientWidth) {
            const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
            section_nav.scrollTo({ left: Math.max(0, left - (section_nav.clientWidth - active_link.offsetWidth) / 2), behavior: smooth ? "smooth" : "auto" });
        }
    }
}

// Keep section anchor scroll offset matched to the sticky top bar on narrow screens
const sidebar = document.querySelector(".sidebar");
function sync_sticky_offset() {
    if (!sidebar) return;
    if (matchMedia("(max-width: 900px)").matches) {
        document.documentElement.style.setProperty("--sticky-h", sidebar.offsetHeight + "px");
    } else {
        document.documentElement.style.removeProperty("--sticky-h");
    }
}
if (sidebar && typeof ResizeObserver === "function") new ResizeObserver(sync_sticky_offset).observe(sidebar);
sync_sticky_offset();

// The active section is the last one whose top has scrolled past a line 30% down the viewport
function update_active() {
    const line = window.innerHeight * 0.3;
    let active = 0;
    page_sections.forEach((sec, i) => {
        if (sec.getBoundingClientRect().top <= line) active = i;
    });
    // At the very bottom of the page, short final sections can never reach the line
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        active = page_sections.length - 1;
    }
    set_active(active);
}

window.addEventListener("scroll", update_active, { passive: true });
window.addEventListener("resize", update_active);
update_active();
