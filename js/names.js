// Display helpers for species names, shared by the landing page and space pages.

// Words kept lowercase inside a common name ("Lily of the Valley", "Bird of Paradise")
const NAME_MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

// Title-case a common name: capitalize the first letter of each space-separated word, except
// minor words mid-name. Hyphenated parts are left as given, so iNaturalist's bird names keep
// their official forms ("Black-billed Magpie", "Western Wood-Pewee").
function formatCommonName(name) {
    return name.trim().split(/\s+/).map((word, i) => {
        if (i > 0 && NAME_MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
        const first = word.search(/\p{L}/u); // skip leading punctuation like "("
        return first < 0 ? word : word.slice(0, first) + word.charAt(first).toUpperCase() + word.slice(first + 1);
    }).join(" ");
}

// A taxon's display name: its common name in title case, or its scientific name (italicized
// by the caller) when there's no common name. Returns { text, scientific }.
function taxonDisplayName(taxon) {
    if (taxon?.preferred_common_name) return { text: formatCommonName(taxon.preferred_common_name), scientific: false };
    if (taxon?.name) return { text: taxon.name, scientific: true };
    return { text: "Unknown species", scientific: false };
}
