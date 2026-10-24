// Entry for the shareable demo: one sample commercial lot with its imagery
// built in, since the demo page can't load map tiles or search addresses.
import { config } from "./config";
import { newJob, PALETTE, uid, type Job } from "./job";
import lotImage from "./demo/lot.jpg?inline";

const BOUNDS: [[number, number], [number, number]] = [
  [42.0903001, -71.263817],
  [42.0926999, -71.260583],
];

function sampleJob(): Job {
  const job = newJob([42.09155, -71.26185], 18.5);
  job.name = "Sample commercial lot";
  job.address = "Patriot Place lots, Foxborough, MA";
  job.areaRate = 0.15;
  job.lineRate = 0.75;
  job.minimum = 450;
  job.notes = "Concrete lot gets surface cleaner + post-treat. Asphalt is a rinse only.";
  job.measurements = [
    {
      id: uid(),
      name: "Concrete lot",
      kind: "area",
      color: PALETTE[0],
      rate: 0.18,
      subtract: false,
      points: [
        [42.0917659, -71.2624578],
        [42.0918429, -71.2622101],
        [42.091905, -71.2618452],
        [42.0911473, -71.2616209],
        [42.0910914, -71.2620427],
        [42.0910852, -71.2621599],
        [42.0912342, -71.2622268],
        [42.0914578, -71.262344],
        [42.0916317, -71.2624277],
      ],
    },
    {
      id: uid(),
      name: "Asphalt lot east",
      kind: "area",
      color: PALETTE[2],
      rate: 0.08,
      subtract: false,
      points: [
        [42.0919547, -71.2618335],
        [42.0920851, -71.2612644],
        [42.0914578, -71.2608711],
        [42.0913398, -71.2609547],
        [42.0911908, -71.2614736],
        [42.0911473, -71.2616209],
        [42.091905, -71.2618452],
      ],
    },
    {
      id: uid(),
      name: "Exclude: hedge planter",
      kind: "area",
      color: PALETTE[3],
      rate: 0.08,
      subtract: true,
      points: [
        [42.091905, -71.2618452],
        [42.0919199, -71.2617917],
        [42.0911647, -71.2615707],
        [42.0911473, -71.2616209],
      ],
    },
    {
      id: uid(),
      name: "Curb, north drive",
      kind: "line",
      color: PALETTE[1],
      rate: 0.75,
      subtract: false,
      points: [
        [42.0919547, -71.2618335],
        [42.0920851, -71.2612644],
      ],
    },
  ];
  return job;
}

config.demo = {
  imagery: {
    url: lotImage,
    bounds: BOUNDS,
    attribution: "Imagery: USDA NAIP via USGS The National Map (public domain)",
  },
  sampleJob,
};

void import("./main");
