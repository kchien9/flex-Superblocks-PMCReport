export interface PmcPreset {
  key: string;
  label: string;
  primaryPmcName: string;
  subsidiaryPmcNames: string[];
}

export const PMC_PRESETS: PmcPreset[] = [
  {
    key: "asset_living",
    label: "Asset Living Family (7 subsidiaries)",
    primaryPmcName: "Asset Living",
    subsidiaryPmcNames: [
      "Asset Living - Student",
      "Echelon Property Group (an Asset Living company)",
      "FPI (An Asset Living Company)",
      "First Communities (an Asset Living Company)",
      "Lund Company (an Asset Living Company)",
      "Strategic Management Partners (an Asset Living Company)",
      "Trinity Multifamily (an Asset Living Company)",
    ],
  },
];
