/**
 * Rotating quick-facts pool — shown in the ambient view's "quick fact"
 * card. Rotates every ~8 seconds so someone walking up to the kiosk is
 * likely to catch a fresh one.
 *
 * Each fact is {headline, body, category, when?}:
 *   - headline: the big number / keyword (like "180+", "LZ-4", "RTLS")
 *   - body:     the one-sentence context
 *   - category: display badge under the card ("VSFB HISTORY", "CADENCE", etc.)
 *   - when?:    optional predicate — fact is only eligible if it returns
 *               true given the current launch context. Lets us surface
 *               launch-specific facts (e.g. "this is booster's 12th flight")
 *               when appropriate and skip them when not.
 *
 * Kept as a plain array (not a React component) so both layouts can
 * import and rotate through the same pool, and so we can extend it
 * later with dynamic facts derived from LL2 data.
 */

export const STATIC_FACTS = [
  {
    headline: '180+',
    suffix: 'orbital missions',
    body: 'VSFB has launched 180+ orbital missions since 1958',
    category: 'VSFB HISTORY',
  },
  {
    headline: '20+',
    suffix: 'booster reflights',
    body: 'Falcon 9 boosters have flown 20+ times each — reuse is now routine',
    category: 'REUSE ERA',
  },
  {
    headline: 'LZ-4',
    suffix: 'landing zone',
    body: 'LZ-4 sits next door to SLC-4E — RTLS recoveries boom inland',
    category: 'RECOVERY',
  },
  {
    headline: 'SLC-4E',
    suffix: 'primary pad',
    body: "SLC-4E is one of SpaceX's two primary West Coast pads",
    category: 'PAD FACT',
  },
  {
    headline: '1958',
    suffix: 'first launch',
    body: 'Thor-Able 1 was VSFB\u2019s first satellite launch attempt',
    category: 'VSFB HISTORY',
  },
  {
    headline: '4,000+',
    suffix: 'Starlink satellites',
    body: 'Most VSFB Falcon 9 flights now carry a batch of Starlink satellites to LEO',
    category: 'MISSION MIX',
  },
  {
    headline: 'SSO',
    suffix: 'polar gateway',
    body: 'VSFB flies south over open Pacific — ideal for sun-synchronous and polar orbits',
    category: 'ORBITS',
  },
  {
    headline: '~4.85 mi/s',
    suffix: 'orbital velocity',
    body: 'Falcon 9 second stage accelerates to ~4.85 mi/s (17,500 mph) to reach low-Earth orbit',
    category: 'PHYSICS',
  },
  {
    headline: '8 min',
    suffix: 'to orbit',
    body: 'Typical VSFB Starlink mission reaches SECO ~8\u00a030 after liftoff',
    category: 'TIMELINE',
  },
  {
    headline: 'SB',
    suffix: 'sonic boom',
    body: 'Returning boosters trigger an audible double-boom across Lompoc and Santa Maria',
    category: 'RECOVERY',
  },
  {
    headline: 'LC-576E',
    suffix: 'historic site',
    body: 'Vandenberg once housed a Cold-War-era Peacekeeper ICBM silo at LC-576E',
    category: 'VSFB HISTORY',
  },
  {
    headline: '~70 min',
    suffix: 'deploy window',
    body: 'Starlink v2 mini stacks typically deploy ~62 minutes after liftoff',
    category: 'TIMELINE',
  },
  {
    headline: '99,600',
    suffix: 'acres',
    body: 'Vandenberg SFB spans about 99,600 acres along the Central California coast',
    category: 'VSFB FACTS',
  },
  {
    headline: '~155 mi',
    suffix: 'karman line',
    body: 'Space begins ~62 miles up (Kármán line); Falcon 9 crosses it in ~2.5 minutes',
    category: 'PHYSICS',
  },
  {
    headline: 'SLC-6',
    suffix: 'old shuttle pad',
    body: 'SLC-6 was built for Space Shuttle polar launches that never flew — now used by Vulcan',
    category: 'PAD FACT',
  },
  {
    headline: '~160 mi',
    suffix: 'stage sep altitude',
    body: 'MECO and stage separation occur at roughly 50 miles up, ~160 miles downrange',
    category: 'TIMELINE',
  },
  {
    headline: '1.7M lbf',
    suffix: 'sea-level thrust',
    body: 'Nine Merlin engines produce about 1.7 million pounds of thrust at liftoff',
    category: 'PHYSICS',
  },
  {
    headline: '230 ft',
    suffix: 'Falcon 9 height',
    body: 'Falcon 9 stands about 230 feet tall — roughly a 22-story building',
    category: 'VEHICLE',
  },
  {
    headline: '25+',
    suffix: 'flights per year',
    body: 'VSFB now averages 25+ Falcon 9 launches per year — a modern cadence record',
    category: 'CADENCE',
  },
  {
    headline: '340 mi',
    suffix: 'typical Starlink alt',
    body: 'VSFB Starlink shells deploy near 340 miles altitude before raising their own orbits',
    category: 'ORBITS',
  },
  {
    headline: 'OCISLY',
    suffix: 'Pacific droneship',
    body: '"Of Course I Still Love You" catches West Coast boosters downrange in the Pacific',
    category: 'RECOVERY',
  },
  {
    headline: 'T-35 min',
    suffix: 'fueling start',
    body: 'Densified LOX and chilled RP-1 load starting at T-35 minutes — a tight choreography',
    category: 'TIMELINE',
  },
  {
    headline: 'RTLS',
    suffix: 'return to launch',
    body: 'RTLS landings at LZ-4 only happen on lighter payloads with margin to boost back',
    category: 'RECOVERY',
  },
  {
    headline: 'Lompoc',
    suffix: 'host city',
    body: 'Lompoc neighbors the base — locals hear the sonic booms minutes after landing',
    category: 'LOCAL',
  },
  {
    headline: 'NROL',
    suffix: 'classified flights',
    body: 'NROL missions from VSFB carry U.S. reconnaissance satellites — launch times are often secret',
    category: 'MISSION MIX',
  },
  {
    headline: '~3 Gs',
    suffix: 'peak acceleration',
    body: 'A Falcon 9 payload typically sees ~3 Gs of acceleration during ascent',
    category: 'PHYSICS',
  },

  /* ======================================================================
   * v36 expansion — CORONA, ICBMs, NRO, failed launches, Lompoc color,
   * and ops facts. Drawn from declassified NRO histories, Air Force base
   * records, and Josh's family (grandpa McAdams worked on CORONA).
   * ==================================================================== */

  // -------- CORONA / Discoverer: America's first spy satellites --------
  {
    headline: 'CORONA',
    suffix: 'the original spy sat',
    body: 'CORONA was America\u2019s first space-based photo reconnaissance program \u2014 it flew from Vandenberg from 1959 to 1972',
    category: 'CORONA',
  },
  {
    headline: 'Discoverer 1',
    suffix: 'Feb 28, 1959',
    body: 'Discoverer 1 lifted off from Vandenberg as the world\u2019s first polar-orbiting satellite \u2014 CORONA\u2019s public cover story',
    category: 'CORONA',
  },
  {
    headline: '13',
    suffix: 'failures before success',
    body: 'The first 13 CORONA launches failed in various ways before Discoverer 14 finally returned film on Aug 18, 1960',
    category: 'CORONA',
  },
  {
    headline: 'Discoverer 14',
    suffix: 'first film return',
    body: 'Discoverer 14\u2019s film bucket was snatched mid-air by a C-119 over the Pacific \u2014 the first object ever recovered from orbit',
    category: 'CORONA',
  },
  {
    // v48: consolidated the five GRANDPA/DAD facts down to this single
    // merged one per user edit. `dwellMs` pins this card on screen for
    // 10s instead of the default 8s rotation since it's the longest body
    // and the most personal — give viewers time to actually read it.
    headline: 'GRANDPA/DAD',
    suffix: 'NRO',
    body: 'My dad worked for the National Reconnaissance Office for most of my life \u2014 quiet work, the kind you don\u2019t talk about at dinner \u2014 his father, my grandpa, worked on the very first recon satellites (CORONA).',
    category: 'FAMILY',
    dwellMs: 10000,
  },
  {
    headline: '145',
    suffix: 'CORONA missions',
    body: 'CORONA flew 145 missions from VAFB over 13 years \u2014 classified until 1995',
    category: 'CORONA',
  },
  {
    headline: 'KH-4B',
    suffix: 'final CORONA cam',
    body: 'The last CORONA variant (KH-4B) resolved objects about 6 feet across from orbit \u2014 jaw-dropping for 1967',
    category: 'CORONA',
  },
  {
    headline: '1995',
    suffix: 'CORONA declassified',
    body: 'President Clinton declassified the CORONA program in 1995 \u2014 and its 800,000+ images transformed historical mapping overnight',
    category: 'CORONA',
  },
  {
    headline: 'Thor',
    suffix: 'CORONA\u2019s ride',
    body: 'Most CORONA birds flew on Thor-Agena boosters from SLC-1, SLC-2, SLC-3, and SLC-5 \u2014 Vandenberg\u2019s original workhorses',
    category: 'CORONA',
  },
  {
    headline: 'C-119',
    suffix: 'flying snatcher',
    body: 'Air Force C-119 and later JC-130 aircraft trailed long poles to snag CORONA film capsules mid-descent',
    category: 'CORONA',
  },
  {
    headline: 'GAMBIT',
    suffix: 'CORONA\u2019s sharper sibling',
    body: 'GAMBIT (KH-7/KH-8) flew from Vandenberg after CORONA \u2014 higher resolution, same film-return trick',
    category: 'NRO',
  },
  {
    headline: 'HEXAGON',
    suffix: '"Big Bird"',
    body: 'HEXAGON KH-9 \u201cBig Bird\u201d flew on Titan IIIDs from VAFB\u2019s SLC-4E \u2014 it carried four film return capsules per bird',
    category: 'NRO',
  },

  // -------- ICBM / Thor / Atlas / Titan history --------
  {
    headline: 'ICBM',
    suffix: 'Cold War cradle',
    body: 'Vandenberg was the nation\u2019s operational and test home for Thor, Atlas, Titan, and Minuteman ICBMs from the late 1950s on',
    category: 'COLD WAR',
  },
  {
    headline: 'Thor',
    suffix: 'IRBM heritage',
    body: 'The Thor intermediate-range ballistic missile first flew from Vandenberg in 1958 and fathered a whole family of space launchers',
    category: 'COLD WAR',
  },
  {
    headline: 'Atlas D',
    suffix: 'first AF ICBM test',
    body: 'The Atlas D made the first US Air Force operational ICBM test launch from Vandenberg on Sept 9, 1959',
    category: 'COLD WAR',
  },
  {
    headline: 'Titan II',
    suffix: 'heaviest ICBM',
    body: 'Titan II was the heaviest US ICBM ever deployed \u2014 Vandenberg hosted its test launches and later Gemini-flavored space variants',
    category: 'COLD WAR',
  },
  {
    headline: 'Minuteman',
    suffix: 'silo tests',
    body: 'Unarmed Minuteman III tests still fly from Vandenberg today \u2014 proving the nuclear deterrent without warheads',
    category: 'COLD WAR',
  },
  {
    headline: 'Peacekeeper',
    suffix: 'MX missile',
    body: 'The Peacekeeper ICBM (LGM-118) tested from Vandenberg carried up to 10 MIRV warheads \u2014 retired in 2005',
    category: 'COLD WAR',
  },
  {
    headline: 'Kwajalein',
    suffix: 'test target',
    body: 'Vandenberg\u2019s ICBM tests fly 4,200+ miles downrange to Kwajalein Atoll \u2014 the Army\u2019s Pacific test range',
    category: 'COLD WAR',
  },

  // -------- NRO / classified missions --------
  {
    headline: 'NROL-39',
    suffix: '"Nothing is Beyond Our Reach"',
    body: 'The NROL-39 mission patch from VAFB in 2013 featured an octopus engulfing Earth \u2014 yes, that was the real logo',
    category: 'NRO',
  },
  {
    headline: 'NROL-87',
    suffix: 'Falcon 9 NRO debut',
    body: 'NROL-87 in Feb 2022 was SpaceX\u2019s first dedicated NRO mission from Vandenberg',
    category: 'NRO',
  },
  {
    headline: 'TOPAZ',
    suffix: 'radar-imaging sats',
    body: 'TOPAZ (FIA-R) radar-imaging sats fly polar orbits from VAFB \u2014 weather-independent surveillance',
    category: 'NRO',
  },
  {
    headline: 'KEYHOLE',
    suffix: 'optical recon',
    body: 'Keyhole-class optical recon sats (KH-11 and successors) launched from VAFB see through clouds only occasionally \u2014 but when they do, resolution is legendary',
    category: 'NRO',
  },
  {
    headline: 'NOTAM',
    suffix: 'sudden NROL windows',
    body: 'NROL launch windows often show up in NOTAMs a few days out \u2014 the rest stays classified until the rocket is climbing',
    category: 'NRO',
  },

  // -------- Failed / anomaly launches --------
  {
    headline: 'Taurus',
    suffix: 'OCO \u2014 Feb 2009',
    body: 'The Taurus XL carrying NASA\u2019s Orbiting Carbon Observatory fell into the Pacific after its payload fairing failed to separate',
    category: 'FAILED',
  },
  {
    headline: 'Glory',
    suffix: 'Taurus \u2014 Mar 2011',
    body: 'Two years later, Taurus XL lost NASA\u2019s Glory climate satellite to the same fairing-separation failure \u2014 a devastating repeat',
    category: 'FAILED',
  },
  {
    headline: 'Titan 34D-9',
    suffix: 'Apr 18, 1986',
    body: 'A Titan 34D exploded 8 seconds after liftoff from VAFB carrying a classified KH-9 HEXAGON \u2014 the last Big Bird ever built',
    category: 'FAILED',
  },
  {
    headline: 'Atlas-Centaur',
    suffix: 'May 1991',
    body: 'An Atlas-Centaur failed on its way to orbit from VAFB in May 1991 carrying a classified NRO payload \u2014 a bad day at the Cape and the coast',
    category: 'FAILED',
  },
  {
    headline: 'Thor 101',
    suffix: 'Jan 1959',
    body: 'Discoverer 0 never flew \u2014 its Thor-Agena blew up on a VAFB pad during pre-launch checkout',
    category: 'FAILED',
  },
  {
    headline: 'Minotaur',
    suffix: 'TacSat-3 relight',
    body: 'Vandenberg has also been home to Minotaur I, IV, and C launches \u2014 converted Peacekeeper and Minuteman stages flying civilian payloads',
    category: 'LAUNCH HISTORY',
  },

  // -------- Pad / geography / base facts --------
  {
    headline: 'SLC-3E',
    suffix: 'Atlas V pad',
    body: 'SLC-3E hosts ULA\u2019s Atlas V flights from VAFB \u2014 NRO payloads, Landsat, and classified birds',
    category: 'PAD FACT',
  },
  {
    headline: 'SLC-2W',
    suffix: 'Delta II retired',
    body: 'SLC-2W flew the final Delta II in 2018 \u2014 ICESat-2 closed a 29-year run of one of America\u2019s most reliable rockets',
    category: 'PAD FACT',
  },
  {
    headline: 'SLC-8',
    suffix: 'Minotaur pad',
    body: 'SLC-8 is the commercial/SmallSat pad at VAFB \u2014 it launches Minotaurs and other Northrop Grumman solid-fuel lifters',
    category: 'PAD FACT',
  },
  {
    headline: 'SLC-576E',
    suffix: 'Cold War silo',
    body: 'Space Launch Complex 576E was built as a Peacekeeper ICBM test silo and later reused for small commercial launches',
    category: 'PAD FACT',
  },
  {
    headline: '1957',
    suffix: 'Cooke AFB renamed',
    body: 'The base was Cooke Air Force Base until 1958, when it was renamed Vandenberg after Gen. Hoyt Vandenberg, second AF Chief of Staff',
    category: 'VSFB HISTORY',
  },
  {
    headline: '2021',
    suffix: 'became Space Force base',
    body: 'On May 14, 2021, Vandenberg Air Force Base became Vandenberg Space Force Base \u2014 the VSFB you see on the patches today',
    category: 'VSFB HISTORY',
  },
  {
    headline: 'Point Arguello',
    suffix: 'Navy annex',
    body: 'Much of VAFB\u2019s southern end was once Naval Missile Facility Point Arguello \u2014 merged into Vandenberg in 1964',
    category: 'VSFB FACTS',
  },
  {
    headline: '35 mi',
    suffix: 'shoreline',
    body: 'Vandenberg controls roughly 35 miles of Central California shoreline \u2014 longest coastline of any US military base',
    category: 'VSFB FACTS',
  },
  {
    headline: 'Polar gate',
    suffix: 'only US option',
    body: 'Vandenberg is the only US site that can launch true polar orbits safely \u2014 flying south over open Pacific instead of populated land',
    category: 'ORBITS',
  },

  // -------- Lompoc / local color --------
  {
    headline: 'Lompoc',
    suffix: 'Flower Seed Capital',
    body: 'Lompoc once billed itself as the "Flower Seed Capital of the World" \u2014 summer fields of sweet peas and zinnias beside a rocket range',
    category: 'LOCAL',
  },
  {
    headline: '1787',
    suffix: 'La Purisima Mission',
    body: 'Mission La Purisima Concepci\u00f3n in Lompoc dates to 1787 \u2014 rebuilt after the 1812 earthquake, now a state historic park',
    category: 'LOCAL',
  },
  {
    headline: 'Surf Beach',
    suffix: 'train stop',
    body: 'Amtrak\u2019s Surf station sits inside Vandenberg \u2014 the railroad predates the base by half a century',
    category: 'LOCAL',
  },
  {
    headline: 'Jalama',
    suffix: 'rocket viewing',
    body: 'Jalama Beach south of the base is a favorite rocket-viewing spot \u2014 you see the pad over Sudden Flats and hear the boom later',
    category: 'LOCAL',
  },
  {
    headline: 'Honda Point',
    suffix: 'Navy disaster',
    body: 'In 1923, seven Navy destroyers ran aground at Honda Point inside present-day VAFB \u2014 the worst peacetime loss in US Navy history',
    category: 'LOCAL',
  },

  // -------- Ops / physics / cadence --------
  {
    headline: 'AFTS',
    suffix: 'autonomous flight term',
    body: 'Falcon 9 uses an autonomous flight termination system \u2014 the rocket decides if it has to self-destruct, not a human',
    category: 'PHYSICS',
  },
  {
    headline: '~26s',
    suffix: 'max-Q',
    body: 'Max aerodynamic pressure (max-Q) hits Falcon 9 around T+70 to 90 seconds \u2014 the engines throttle down to survive it',
    category: 'TIMELINE',
  },
  {
    headline: 'T+2:30',
    suffix: 'MECO window',
    body: 'Main Engine Cutoff typically happens around T+2:30 \u2014 then the booster coasts, flips, and lights up for boostback',
    category: 'TIMELINE',
  },
  {
    headline: '~330 mph',
    suffix: 'landing descent',
    body: 'A returning Falcon 9 booster hits terminal velocity near 330 mph before a single-engine burn brings it to walking speed for touchdown',
    category: 'RECOVERY',
  },
  {
    headline: '2 min',
    suffix: 'from sep to touch',
    body: 'From stage separation to LZ-4 touchdown is roughly 7\u20138 minutes \u2014 the booster outruns the sound of its own landing',
    category: 'TIMELINE',
  },
  {
    headline: '10 Starlinks',
    suffix: 'per v2 mini batch',
    body: 'Typical west-coast Starlink v2 mini stacks carry 20\u201322 satellites \u2014 each weighing about 1,760 lbs',
    category: 'MISSION MIX',
  },
  {
    headline: 'Transporter',
    suffix: 'rideshare maxout',
    body: 'Transporter missions from VAFB pack 90+ payloads for dozens of customers into a single polar flight',
    category: 'MISSION MIX',
  },
  {
    headline: 'Formosat',
    suffix: 'SpaceX first VAFB',
    body: 'Formosat-5 on Aug 24, 2017 was SpaceX\u2019s first Vandenberg mission for a non-US customer \u2014 Taiwan\u2019s earth-observing bird',
    category: 'MISSION MIX',
  },
  {
    headline: 'SAOCOM 1B',
    suffix: 'Argentina SAR',
    body: 'Argentina\u2019s SAOCOM 1A/1B radar sats flew from VAFB \u2014 yet another polar-orbit payload best served by the California coast',
    category: 'MISSION MIX',
  },
  {
    headline: '1 drought',
    suffix: 'pad dormancy',
    body: 'SLC-4E sat cold from its final Titan IV flight in 2005 until SpaceX lit it back up in 2013 \u2014 eight quiet years',
    category: 'PAD FACT',
  },
  {
    headline: 'Falcon Heavy',
    suffix: 'West Coast plan',
    body: 'SLC-4E has been proposed for Falcon Heavy West Coast launches but has never yet flown a triple-core from VAFB',
    category: 'VEHICLE',
  },
  {
    headline: 'Vulcan',
    suffix: 'ULA\u2019s new VAFB ride',
    body: 'ULA\u2019s Vulcan Centaur is taking over VAFB\u2019s SLC-3E duties as Atlas V retires \u2014 methane + RP-1 engine heritage meets VAFB polar slots',
    category: 'VEHICLE',
  },
  {
    headline: '11,000 ft',
    suffix: 'runway',
    body: 'VAFB\u2019s runway (built for the cancelled Space Shuttle polar program) is about 11,000 feet long \u2014 still used by aircraft ferrying NRO hardware',
    category: 'VSFB FACTS',
  },
  {
    headline: 'Shuttle',
    suffix: 'never flew here',
    body: 'The Space Shuttle was supposed to fly polar DoD missions from VAFB\u2019s SLC-6 \u2014 Challenger ended those plans in 1986',
    category: 'VSFB HISTORY',
  },
  {
    headline: 'Hi Mtn',
    suffix: 'radar view',
    body: 'The Hi Mountain Lookout near Pozo catches Vandenberg launches on a clear night \u2014 the arc stretches all the way inland',
    category: 'LOCAL',
  },
];

/**
 * Build a fact list for a given launch context, composed of the static
 * pool plus any launch-derived facts we can surface from LL2 data.
 *
 * We generate dynamic facts lazily (only when we actually have the
 * underlying data) so the rotation never shows an empty or "—" card.
 */
export function buildFacts(launch, boosterHistory) {
  const extras = [];
  const booster = launch?.booster;
  const histEntry = booster?.serial_number ? boosterHistory?.[booster.serial_number] : null;
  const stats = histEntry?.stats || null;

  if (booster?.serial_number && booster.launcher_flight_number) {
    extras.push({
      headline: booster.serial_number.toUpperCase(),
      suffix: `flight #${booster.launcher_flight_number}`,
      body: `This launch uses booster ${booster.serial_number.toUpperCase()} on its ${ordinal(
        booster.launcher_flight_number,
      )} flight`,
      category: 'THIS BOOSTER',
    });
  }
  if (stats?.fastest_days != null) {
    extras.push({
      headline: formatDaysShort(stats.fastest_days),
      suffix: 'fastest turnaround',
      body: `This booster's quickest reuse: ${formatDaysShort(stats.fastest_days)} between flights`,
      category: 'REUSE STATS',
    });
  }
  if (launch?.is_rtls) {
    extras.push({
      headline: 'RTLS',
      suffix: 'land landing',
      body: 'Today\u2019s booster is returning to Landing Zone 4 \u2014 sonic boom likely',
      category: 'RECOVERY',
    });
  }
  return [...extras, ...STATIC_FACTS];
}

/**
 * Fisher-Yates shuffle of [0..n). If `avoidFirst` is provided, ensures
 * the resulting deck does NOT start with that index — prevents the
 * "same fact shown twice in a row" case when a deck wraps around.
 * Exported so both layouts can share the identical randomizer.
 */
export function shuffleIndices(n, avoidFirst = null) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (avoidFirst != null && arr.length > 1 && arr[0] === avoidFirst) {
    const swap = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swap]] = [arr[swap], arr[0]];
  }
  return arr;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDaysShort(days) {
  if (days == null || !Number.isFinite(days)) return '—';
  const d = Math.floor(days);
  const h = Math.floor((days - d) * 24);
  if (d === 0) return `${h}h`;
  if (h === 0) return `${d}d`;
  return `${d}d ${h}h`;
}
