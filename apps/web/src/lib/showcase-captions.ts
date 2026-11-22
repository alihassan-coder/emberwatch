// Plain-language captions for the "Try to fool it" gallery, written after
// looking at each real frame (the dataset has no scene labels). Keyed by file.
export const CAPTIONS: Record<string, string> = {
  // It ignores these: real frames that fooled an earlier detection system
  "gallery/ignored/00.jpg": "Thick fog with a green colour cast",
  "gallery/ignored/01.jpg": "Cloud rolling over the ridge",
  "gallery/ignored/02.jpg": "Night, with lights flaring in the lens",
  "gallery/ignored/03.jpg": "A towering cloud bank lit by the sun",
  "gallery/ignored/04.jpg": "Grey fog drifting through the trees",
  "gallery/ignored/05.jpg": "Sun glare on the lens",
  "gallery/ignored/06.jpg": "A small white cloud on the ridge: the classic smoke look-alike",
  "gallery/ignored/07.jpg": "Low cloud lying along the valleys",

  // It catches these: the smallest plumes in the test set
  "gallery/caught/00.jpg": "Faint smoke in evening light over the mountains",
  "gallery/caught/01.jpg": "Smoke under storm clouds, above a valley town",
  "gallery/caught/02.jpg": "Distant smoke beyond the hills, next to a telecom mast",
  "gallery/caught/03.jpg": "Smoke at dusk, above a town with its lights on",
  "gallery/caught/04.jpg": "Smoke on the horizon beyond a town",
  "gallery/caught/05.jpg": "Smoke rising far out over a pine forest",
  "gallery/caught/06.jpg": "Smoke deep in a mountain range",
  "gallery/caught/07.jpg": "Smoke beyond a ridge under heavy cloud",
};
