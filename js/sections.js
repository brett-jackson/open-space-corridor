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

function set_active(index) {
    nav_links.forEach((a, i) => {
        if (i === index) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
    });
}

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
