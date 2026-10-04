// Numbers shown on the page. Every value is copied from the camera-ready paper
// (source noted per block); do not compute new statistics here.
window.PAGE_DATA = {
  // Table 1 (Section 5.1). Triples are [Iso, Ours, Oracle].
  sim: {
    revolute:    { label: "Revolute",    sr: [99, 99, 99],    se: 1.64, icf: [7.18, 2.62, 2.13], pcf: [3.38, 1.56, 1.48], icm: [0.29, 0.22, 0.22], pcm: [0.19, 0.18, 0.17] },
    cylindrical: { label: "Cylindrical", sr: [99, 100, 100],  se: 1.73, icf: [5.31, 0.83, 0.53], pcf: [1.96, 0.36, 0.31], icm: [0.32, 0.22, 0.21], pcm: [0.16, 0.14, 0.14] },
    planar:      { label: "Planar",      sr: [99, 99, 99],    se: 2.78, icf: [15.3, 1.93, 2.20], pcf: [4.03, 1.18, 1.16], icm: [0.74, 0.48, 0.34], pcm: [0.29, 0.23, 0.21] },
    universal:   { label: "Universal",   sr: [100, 100, 100], se: 4.36, icf: [2.18, 0.46, 0.34], pcf: [1.25, 0.23, 0.19], icm: null, pcm: null }
  },
  // Table 2 (Section 5.2). Pairs are [Iso, Ours]; ratio = Ours/Iso as printed in the paper.
  real: [
    { label: "Revolute",    object: "Laptop",         se: 13.01, icf: [46.6, 25.2, 0.54], pcf: [8.54, 3.62, 0.42], icm: [5.00, 3.34, 0.67], pcm: [0.93, 0.37, 0.40] },
    { label: "Prismatic",   object: "Drawer",         se: 4.74,  icf: [12.3, 8.79, 0.72], pcf: [4.63, 3.51, 0.76], icm: [1.84, 1.46, 0.80], pcm: [0.61, 0.55, 0.90], fullMoment: true },
    { label: "Helical",     object: "Screw",          se: 2.89,  icf: [6.96, 6.50, 0.93], pcf: [4.56, 4.40, 0.96], icm: [1.82, 0.60, 0.33], pcm: [1.08, 0.45, 0.41] },
    { label: "Cylindrical", object: "Phone stand",    se: 5.76,  icf: [8.35, 4.42, 0.53], pcf: [3.37, 2.20, 0.65], icm: [1.09, 0.82, 0.75], pcm: [0.45, 0.37, 0.81] },
    { label: "Crank",       object: "Coffee grinder", se: 5.70,  icf: [20.8, 23.6, 1.14], pcf: [4.62, 4.28, 0.93], icm: [4.99, 4.15, 0.83], pcm: [1.12, 0.82, 0.74] }
  ],
  // Section 5.2 text: Ours/Iso averaged over the objects (prismatic excluded for the moments).
  realAverage: { icf: 0.72, pcf: 0.70, icm: 0.69, pcm: 0.56 }
};
