# Game design

## Premise

Illegal night racing on Delhi's ring roads and flyovers. Fourteen riders, no
rules, point-to-point. You start last, every time. Finish top three to move up.

## Structure

- **Five routes × five tiers = 25 races.** Each tier extends the same route
  further rather than replacing it. Tier 1 routes run ~8 km; each tier adds
  4–6 km to the end.
- Finish third or better on all five routes to unlock the next tier.
- **Career** (money, bike shop, reputation) and **Quick Race** (any unlocked
  route and tier, no economy).

## Routes

Ordered easiest to hardest. All original.

| Route | Character | Signature hazard |
|---|---|---|
| Ridge Run | Forested, sweeping, low traffic, few lights | Deer, blind crests |
| Yamuna Bank | Wide riverside road, long straights | Fog banks, sand on the road |
| Ring Road | Multi-lane, heavy traffic, constant lane changes | DTC buses, sudden merges |
| Old City | Narrow, tight, pedestrians, no shoulder | Zero room to recover |
| DND Flyway | Elevated expressway, fastest route in the game | No barrier on one side — leaving the road ends your race |

Each route has at least two forks. One branch is tighter or busier; the other
is more open. Neither should be strictly correct.

**Forks are never balanced with raw distance.** If one branch is meaningfully
shorter in metres, it is simply the right answer and the choice stops being a
choice. So: both branches of a fork rejoin at equal `progress` (see
`ARCHITECTURE.md` §1.2), and their lengths in metres differ by no more than
about 5% — enough that the routes feel different to ride, not enough to decide
the race on its own. The real levers are corner tightness, traffic density,
hazard placement, and how much room there is to fight. A fork should be a bet
about the kind of rider you are, not an arithmetic problem with one answer.

## Riders

Fourteen racers total: the player plus thirteen rivals. Each has:

```ts
interface RacerProfile {
  id: string;
  name: string;
  skill: number;        // 0..1 — racing line quality, reaction time
  aggression: number;   // 0..1 — how readily they attack
  vengefulness: number; // 0..1 — how much a hit shifts their standing
  caution: number;      // 0..1 — traffic avoidance vs. commitment
  startingBike: string;
  startingCash: number;
  startingWeapon: string | null;
  bio: string;          // two lines, written in the game's voice
}
```

Invent all fourteen. Give them a mix — a courier who knows the city better
than anyone, a rich kid on a bike he can't handle, a mechanic who never
attacks first but never forgets. Names should be plausibly Delhi.

## Bikes

Fifteen bikes across three classes. All original names — invent a handful of
in-world manufacturers and use them consistently.

| Class | Count | Top speed range | Character |
|---|---|---|---|
| Street | 5 | 150–190 km/h | Cheap, patched together, honest handling |
| Sport | 5 | 190–235 km/h | The working range of the game |
| Super | 5 | 235–280 km/h | Nitro-equipped, punishing, tier 4–5 only |

```ts
interface Bike {
  id: string;
  make: string;
  model: string;
  class: 'street' | 'sport' | 'super';
  price: number;
  power: number;           // kW. DISPLAY ONLY — the sim never reads this.
  mass: number;            // kg — combat shove and cornering grip only.
  topSpeed: number;        // km/h. Authoritative: the ceiling.
  timeToTopSpeed: number;  // seconds, 0 to topSpeed. Authoritative: the magnitude.
  accelCurve: number[];    // SHAPE ONLY, normalised, at 0/25/50/75/100% of
                           // topSpeed. The sim rescales it so the integral
                           // matches timeToTopSpeed exactly.
  handling: number;        // 0..1 — lateral responsiveness
  stability: number;       // 0..1 — resistance to being knocked off line
  nitro: number;           // charges; 0 for street and sport
  blurb: string;
}
```

**Which field is authoritative for what.** Speed, acceleration, power, and
mass over-determine a vehicle: given any three you can derive the fourth, and
two sources of truth that disagree is a bug waiting for a tuning session. So
the split is fixed, and the sim is only allowed to read the right-hand column:

| Quantity | Authority | Read by the sim? |
|---|---|---|
| Top speed | `topSpeed` | yes |
| How long to reach it | `timeToTopSpeed` | yes |
| How the acceleration is distributed on the way | `accelCurve`, rescaled | yes |
| Combat shove, cornering grip | `mass` | yes |
| Engine power | `power` | **no** — shop and garage display only |

`accelCurve` carries no magnitude. Doubling every entry in it changes the
character of the acceleration and not the time to top speed, which is what
makes it safe to tune by feel.

Design rules:
- No bike is strictly best. The fastest Super must be genuinely hard to keep
  on the DND Flyway.
- Mass is a real trade: heavy bikes win shoving contests and lose corners.
- The best-value bike in each class should be obvious in hindsight but not
  from the stat sheet — that's what makes the shop interesting.
- Buying trades in your current bike at roughly 60% of its price.

## Combat

Attacks: **punch** (fast, low damage, short range), **kick** (slower, pushes
laterally, best for forcing someone off the road), **backhand** (slowest,
highest damage, leaves you exposed).

Each attack has windup / active / recovery frames. You cannot steer during
windup and recovery, which is the real cost — attacking on a corner is how
you crash.

**Stamina** runs 0–100. At zero, the rider goes down. Stamina regenerates
slowly while not being hit.

**Weapons** — pipe, chain, cricket bat — multiply damage and extend range.
You get one by picking it up from a downed rider or by landing a clean hit on
an armed one, which knocks it loose. You lose yours the same way. Weapons are
not bought; they only circulate.

**Getting hit** costs stamina, staggers you (brief loss of lateral control),
and pushes your `t`. Near the DND Flyway's open edge, that push is the whole
danger.

The HUD shows two stamina bars: yours, and the rider you are currently
engaged with — the nearest rider inside combat range.

## Police

Police riders spawn per tier density. They pursue when you are speeding
noticeably, ram to destabilise you, and arrest you if you crash within about
15 m of one. An arrest ends your race and levies a fine. Failing to pay
forces you to sell down to a cheaper bike.

## Economy

| Finish | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---|---|---|---|---|---|
| 1st | 8,000 | 16,000 | 28,000 | 45,000 | 70,000 |
| 2nd | 6,000 | 12,000 | 21,000 | 34,000 | 52,000 |
| 3rd | 4,000 | 8,000 | 14,000 | 22,000 | 35,000 |
| 4th–8th | 1,000 | 2,000 | 3,500 | 5,500 | 8,500 |

Currency is rupees. Fines and repairs scale with bike value, so a Super bike
makes a bad race genuinely expensive. Balance target: reaching each tier's
appropriate bike class requires roughly one clean run of the five routes plus
about two repeat races.

## Reputation

The feature that makes this more than a racer. A standing value from −100 to
+100 for every ordered pair of racers, seeded from the profiles.

Standing shifts during a race:

| Event | Effect |
|---|---|
| You hit a racer | Their standing toward you drops, scaled by their vengefulness |
| You knock a racer down | Larger drop |
| You hit someone's ally | Smaller drop from the ally |
| You hit someone's enemy | Small gain |
| You take hits from their enemy without retaliating | Small gain |
| You finish a race without hitting anyone | Small gain from everyone above neutral |

Standing changes behaviour in the next race:

- **Ally** (> +40): will body-block rivals chasing you, won't attack you,
  passes a route tip on the social screen.
- **Neutral**: attacks only if you attack first.
- **Enemy** (< −40): actively hunts you, will coordinate with other enemies to
  box you in.

Between races, a social screen shows who is where. Allies give a concrete,
useful tip — a fork recommendation, a hazard warning, a bike rumour. Enemies
just posture. The point is that the player can play the social game as an
alternative to playing the racing game, and both should work.

## Difficulty curve

- **Tier 1** — teach riding. Sparse traffic, docile AI, no police.
- **Tier 2** — teach combat. AI attacks, weapons circulate.
- **Tier 3** — teach the economy. A Street bike stops being viable.
- **Tier 4** — teach the routes. Traffic and police are heavy enough that
  route knowledge matters more than top speed.
- **Tier 5** — everything at once, plus a Super bike you have to respect.
