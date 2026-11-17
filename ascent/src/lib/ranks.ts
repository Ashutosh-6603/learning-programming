/** Real heights, so a number like 4,806 m means something. A repo is worth about 6,600 to 8,800 m. */
export type Rank = { title: string; landmark: string; metres: number };

export const RANKS: Rank[] = [
  { title: 'Trailhead', landmark: 'the car park', metres: 0 },
  { title: 'Day Hiker', landmark: 'the Statue of Liberty', metres: 93 },
  { title: 'Scrambler', landmark: 'the Eiffel Tower', metres: 330 },
  { title: 'Ridge Walker', landmark: 'the Burj Khalifa', metres: 828 },
  { title: 'Fell Runner', landmark: 'Ben Nevis', metres: 1345 },
  { title: 'Rope Hand', landmark: 'Mount Fuji', metres: 3776 },
  { title: 'Alpinist', landmark: 'Mont Blanc', metres: 4806 },
  { title: 'Glacier Guide', landmark: 'Kilimanjaro', metres: 5895 },
  { title: 'Expedition Lead', landmark: 'Denali', metres: 6190 },
  { title: 'High Altitude', landmark: 'Aconcagua', metres: 6961 },
  { title: 'Death Zone', landmark: 'K2', metres: 8611 },
  { title: 'Everester', landmark: 'Mount Everest', metres: 8849 },
  { title: 'Jet Stream', landmark: 'airliner cruising height', metres: 11000 },
  { title: 'Stratonaut', landmark: "Baumgartner's space jump", metres: 38969 },
  { title: 'Astronaut', landmark: 'the edge of space', metres: 100000 },
  { title: 'Orbital', landmark: 'the International Space Station', metres: 408000 },
];

export function rankIndex(metres: number): number {
  let index = 0;
  RANKS.forEach((rank, i) => {
    if (metres >= rank.metres) index = i;
  });
  return index;
}

export function rankProgress(metres: number) {
  const index = rankIndex(metres);
  const rank = RANKS[index] as Rank;
  const next = RANKS[index + 1];
  const fraction = next ? (metres - rank.metres) / (next.metres - rank.metres) : 1;
  return { index, rank, next, fraction, toGo: next ? next.metres - metres : 0 };
}
