/**
 * The golden set for the offline eval: a fixed collection of queries, each with
 * a realistic set of candidate results, the subset of those a human would call
 * relevant, and (for the answer eval) a reference answer and a rubric.
 *
 * This is deliberately hand-curated and stable. It is a regression baseline,
 * not a benchmark: the point is that a change to the reranker, the prompt, or
 * the model moves these numbers in a direction a human can read, not that the
 * numbers are absolute.
 *
 * To grow the set, add an entry with the same shape. Keep the relevant labels
 * unambiguous (a result is clearly about the query or clearly not) so the
 * metric does not depend on a borderline call.
 */

interface GoldenResult {
  title: string;
  snippet: string;
  url: string;
}

export interface GoldenQuery {
  /** Stable id used in reports. */
  id: string;
  query: string;
  results: GoldenResult[];
  /** Indices into `results` a human would consider relevant to `query`. */
  relevant: number[];
  /** Key facts a correct answer must contain (for the LLM judge). */
  referenceAnswer: string;
  /** What a good answer does, checked one point at a time by the judge. */
  rubric: string[];
  /**
   * The answer's key fact exists only in the snippets, not in parametric
   * knowledge or the result titles. These are the entries that fail if the
   * search-results path breaks; the answer eval grades them as a group so a
   * handful of them can't be drowned out by the rest of the set.
   */
  snippetOnly?: boolean;
}

export const goldenQueries: GoldenQuery[] = [
  {
    id: "apollo11-first-moonwalker",
    query: "Who was the first person to walk on the moon?",
    results: [
      {
        title: "Apollo 11: NASA's mission that put humans on the Moon",
        snippet:
          "On July 20, 1969, astronaut Neil Armstrong stepped onto the lunar surface, followed hours later by Buzz Aldrin.",
        url: "https://nasa.gov/apollo-11",
      },
      {
        title: "Neil Armstrong signed baseball cards for sale",
        snippet:
          "Buy a signed memorabilia card from the astronaut who first walked on the Moon. Ships free.",
        url: "https://memorabilia.shop/armstrong-card",
      },
      {
        title: "Moon Hotels: stay in a suite with a lunar view",
        snippet:
          "Luxury suites overlooking the crater. Book your once-in-a-lifetime stay on the Moon.",
        url: "https://travel.com/moon-hotels",
      },
      {
        title: "Apollo 11 - Wikipedia",
        snippet:
          "Apollo 11 was the spaceflight that landed the first humans, Neil Armstrong and Buzz Aldrin, on the Moon on 20 July 1969.",
        url: "https://wikipedia.org/wiki/Apollo_11",
      },
      {
        title: "Moon phase calendar for this month",
        snippet:
          "Track new moon, full moon and quarter phases with our interactive monthly calendar.",
        url: "https://almanac.com/moon-phases",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "Neil Armstrong was the first person to walk on the Moon, on 20 July 1969, during the Apollo 11 mission; Buzz Aldrin was the second.",
    rubric: [
      "Names Neil Armstrong as the first person on the Moon.",
      "Gives the correct date (20 July 1969) or at least the correct mission (Apollo 11).",
      "Does not name Buzz Aldrin as the first (Aldrin was second).",
    ],
  },
  {
    id: "css-flexbox-center",
    query: "how do I center a div with CSS flexbox",
    results: [
      {
        title: "A Complete Guide to Flexbox - CSS-Tricks",
        snippet:
          "Use display: flex with justify-content: center and align-items: center to center content both ways.",
        url: "https://css-tricks.com/flexbox-guide",
      },
      {
        title: "Free CSS Reset stylesheet download",
        snippet:
          "A minimal reset to normalize browser defaults. Copy, paste, ship.",
        url: "https://css-tools.com/reset",
      },
      {
        title: "What is a div tag in HTML?",
        snippet:
          "The div element is a generic container for flow content with no required attributes.",
        url: "https://html-reference.com/div",
      },
      {
        title: "Flexbox cheat sheet poster",
        snippet:
          "Printable poster of all flexbox properties. Order now and master layout at a glance.",
        url: "https://printables.com/flexbox-poster",
      },
      {
        title: "CSS Flexbox - MDN Web Docs",
        snippet:
          "The flex container's main and cross axes let you center items with justify-content and align-items.",
        url: "https://developer.mozilla.org/flexbox",
      },
    ],
    relevant: [0, 4],
    referenceAnswer:
      "Set the parent to display: flex, then use justify-content: center (main axis) and align-items: center (cross axis) to center the child both horizontally and vertically.",
    rubric: [
      "Mentions setting the container to display: flex.",
      "Names justify-content and/or align-items (the actual properties).",
      "Does not present a float, margin, or absolute-positioning hack as the flexbox answer.",
    ],
  },
  {
    id: "australia-capital",
    query: "Qual é a capital da Austrália?",
    results: [
      {
        title: "Canberra: capital of Australia - Visit Canberra",
        snippet:
          "Canberra is the capital city of Australia and the seat of the federal government, in the Australian Capital Territory.",
        url: "https://visitcanberra.com.au/",
      },
      {
        title: "Sydney: top 10 things to do",
        snippet:
          "From the Opera House to Bondi Beach, here is how to spend a week in Australia's biggest city.",
        url: "https://travel.com/sydney-things-to-do",
      },
      {
        title: "Australian visa: eligibility and how to apply",
        snippet:
          "Check if you qualify for an Australian visitor, work or student visa and start your application.",
        url: "https://immigration.gov/australia-visa",
      },
      {
        title: "Austrália - Wikipédia",
        snippet:
          "A capital da Austrália é Camberra, e a maior cidade é Sydney.",
        url: "https://pt.wikipedia.org/wiki/Austrália",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "A capital da Austrália é Camberra (Canberra). Sydney é a cidade mais populosa, mas não é a capital.",
    rubric: [
      "Names Canberra (Camberra) as the capital.",
      "Does not name Sydney as the capital.",
      "If it clarifies, correctly notes Sydney is the largest city but not the capital.",
      "Replies in Portuguese, the language of the question.",
    ],
  },
  {
    id: "git-merge-vs-rebase",
    query: "difference between git merge and git rebase",
    results: [
      {
        title: "Git merge vs rebase - when to use which",
        snippet:
          "git merge creates a new commit joining two histories; git rebase replays your commits on top of another branch.",
        url: "https://git-guides.com/merge-vs-rebase",
      },
      {
        title: "GitKraken: visual Git client download",
        snippet:
          "A cross-platform Git GUI with a visual commit graph. Free for personal use.",
        url: "https://gitkraken.com/download",
      },
      {
        title: "Git logo and brand assets",
        snippet:
          "Download the official Git logo in SVG and PNG for your site or slides.",
        url: "https://brandassets.com/git-logo",
      },
      {
        title: "Git hosting pricing plans",
        snippet:
          "Compare free, team and enterprise plans for private repositories and CI minutes.",
        url: "https://codehost.dev/pricing",
      },
      {
        title: "git-rebase - Git documentation",
        snippet:
          "Rebase rewrites your branch's commits to sit on top of the upstream, producing a linear history.",
        url: "https://git-scm.com/docs/git-rebase",
      },
    ],
    relevant: [0, 4],
    referenceAnswer:
      "git merge combines two branches into a new merge commit, preserving both histories. git rebase replays your commits on top of another branch, rewriting them for a linear history.",
    rubric: [
      "Explains that merge creates/joins histories (a merge commit or preserved branch point).",
      "Explains that rebase replays/moves commits onto another base (linear history, rewrites).",
      "Does not swap the two definitions.",
    ],
  },
  {
    id: "wwii-end-year",
    query: "What year did World War II end?",
    results: [
      {
        title: "World War II - Wikipedia",
        snippet:
          "World War II was a global conflict that lasted from 1939 to 1945, ending with the surrender of Japan in September 1945.",
        url: "https://wikipedia.org/wiki/World_War_II",
      },
      {
        title: "World War II strategy board game",
        snippet:
          "Command the armies of 1939-1945 in this award-winning turn-based strategy game.",
        url: "https://boardgames.com/wwii-strategy",
      },
      {
        title: "Vintage WWII poster prints",
        snippet:
          "Restored wartime posters, ready to frame. A bold piece for any wall.",
        url: "https://prints.com/wwii-posters",
      },
      {
        title: "The end of World War II - History.com",
        snippet:
          "V-E Day in May 1945 and V-J Day in September 1945 marked the end of the war in Europe and the Pacific.",
        url: "https://history.com/wwii-end",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "World War II ended in 1945 (Europe in May 1945, and globally with Japan's surrender in September 1945).",
    rubric: ["Gives 1945 as the end year.", "Does not give a wrong year."],
  },
  {
    id: "jwt-secure-rest-api",
    query: "how to secure a REST API with JWT",
    results: [
      {
        title: "JSON Web Tokens: a practical guide - Auth0",
        snippet:
          "Sign tokens with a strong secret, keep access tokens short-lived, and validate the signature and expiry on every request.",
        url: "https://auth0.com/jwt-guide",
      },
      {
        title: "REST API tutorial for beginners",
        snippet:
          "Learn to build CRUD endpoints with HTTP verbs, status codes and JSON responses.",
        url: "https://tutorials.com/rest-101",
      },
      {
        title: "JWT logo vector download",
        snippet: "The official JWT wordmark as an SVG for your docs.",
        url: "https://logos.com/jwt-svg",
      },
      {
        title: "Managed JWT authentication service pricing",
        snippet:
          "Start free, then pay per monthly active user for hosted auth.",
        url: "https://authvendor.io/pricing",
      },
      {
        title: "JWT Security Best Practices - OWASP",
        snippet:
          "Validate alg, nbf and exp claims; never put secrets in the payload; rotate signing keys.",
        url: "https://owasp.org/jwt-best-practices",
      },
    ],
    relevant: [0, 4],
    referenceAnswer:
      "Use short-lived signed access tokens, validate the signature and claims (exp, nbf, aud) on every request, keep the signing secret strong and rotated, and use refresh tokens for re-authentication.",
    rubric: [
      "Mention validating the token signature on the server.",
      "Mention expiry / short-lived tokens (or exp).",
      "Does not claim the JWT payload is encrypted or secret by default.",
    ],
  },
  {
    id: "largest-ocean",
    query: "qual o maior oceano do mundo",
    results: [
      {
        title: "Oceanos - Wikipédia",
        snippet:
          "O Oceano Pacífico é o maior e mais profundo oceano da Terra, cobrindo cerca de um terço da superfície.",
        url: "https://pt.wikipedia.org/wiki/Oceano_Pacífico",
      },
      {
        title: "Cruise to the South Pacific: 12 nights",
        snippet:
          "Sail between island paradises with daily excursions and all-inclusive dining.",
        url: "https://cruises.com/south-pacific",
      },
      {
        title: "Ocean life: meet the marine animals",
        snippet:
          "From jellyfish to blue whales, explore the creatures that live in the sea.",
        url: "https://nature.com/ocean-animals",
      },
      {
        title: "Geografia: os cinco oceanos do planeta",
        snippet:
          "O Pacífico é o maior oceano, seguido do Atlântico, Índico, Ártico e Antártico.",
        url: "https://geografia.br/os-oceanos",
      },
    ],
    relevant: [0, 3],
    referenceAnswer: "O maior oceano do mundo é o Oceano Pacífico.",
    rubric: [
      "Names the Pacific (Pacífico) as the largest ocean.",
      "Does not name the Atlantic as the largest.",
      "Replies in Portuguese, the language of the question.",
    ],
  },
  {
    id: "hamlet-author",
    query: "Who wrote the play Hamlet?",
    results: [
      {
        title: "Hamlet - Wikipedia",
        snippet:
          "Hamlet is a tragedy written by William Shakespeare between 1599 and 1601, one of his most performed works.",
        url: "https://wikipedia.org/wiki/Hamlet",
      },
      {
        title: "Hamlet at the Royal Court: tickets",
        snippet:
          "Book seats for the season's production of Shakespeare's Hamlet. Premium balcony available.",
        url: "https://theatre.com/hamlet-tickets",
      },
      {
        title: "What is a hamlet (settlement)?",
        snippet:
          "A hamlet is a small rural settlement, typically smaller than a village and without a church.",
        url: "https://geography.com/hamlet-settlement",
      },
      {
        title: "William Shakespeare: the Bard of Avon",
        snippet:
          "Shakespeare wrote 39 plays including Hamlet, Macbeth and Othello, defining the English language stage.",
        url: "https://bard.org/william-shakespeare",
      },
    ],
    relevant: [0, 3],
    referenceAnswer: "Hamlet was written by William Shakespeare.",
    rubric: [
      "Names William Shakespeare as the author.",
      "Does not confuse the play with the meaning of 'hamlet' (a settlement).",
    ],
  },
  {
    id: "react-useeffect-infinite-loop",
    query: "react useEffect infinite loop cause",
    results: [
      {
        title: "React useEffect: avoiding the infinite render loop",
        snippet:
          "A new object or function in the dependency array re-triggers the effect every render. Stabilize it or drop it from the deps.",
        url: "https://react-patterns.com/useeffect-loop",
      },
      {
        title: "React logo and brand guidelines",
        snippet: "Use the official React atom logo in your slides and docs.",
        url: "https://reactjs.org/brand",
      },
      {
        title: "React Native: build mobile apps",
        snippet:
          "Use the latest JavaScript to build native iOS and Android apps with a single codebase.",
        url: "https://reactnative.dev/",
      },
      {
        title: "Frontend course: React pricing",
        snippet:
          "Lifetime access to 40 hours of React and TypeScript video lessons.",
        url: "https://course.dev/react-pricing",
      },
      {
        title: "Why does my useEffect run twice? - Stack Overflow",
        snippet:
          "Updating state that is in the dependency array (or returning a new reference each render) re-runs the effect, which updates state again.",
        url: "https://stackoverflow.com/q/useeffect-twice",
      },
    ],
    relevant: [0, 4],
    referenceAnswer:
      "A useEffect infinite loop is usually caused by a dependency that changes on every render (a new object/function reference) or by updating state that is itself in the dependency array, which re-runs the effect, which updates the state again. Stabilize the dependency (useMemo/useCallback) or restructure the effect.",
    rubric: [
      "Identifies a changing/incorrect dependency array as the cause.",
      "Mentions state updates that re-trigger the effect (the feedback loop).",
      "Suggests a real fix (stabilize the dep, or restructure), not just 'add a key'.",
    ],
  },
  {
    id: "water-boiling-point",
    query: "What is the boiling point of water at sea level?",
    results: [
      {
        title: "Boiling point - Wikipedia",
        snippet:
          "The boiling point of water is 100 °C (212 °F) at standard atmospheric pressure (sea level).",
        url: "https://wikipedia.org/wiki/Boiling_point",
      },
      {
        title: "Electric kettle: 1.7L fast boil",
        snippet:
          "Boil a kettle of water in three minutes with rapid heat and an auto shut-off.",
        url: "https://appliance.com/electric-kettle",
      },
      {
        title: "Industrial water boiler for process heat",
        snippet:
          "Steam generators rated to 15 bar for continuous industrial use.",
        url: "https://industrial.com/water-boiler",
      },
      {
        title: "Water properties reference - Chemistry LibreTexts",
        snippet:
          "At 1 atm, water boils at 100 °C; the point drops with altitude as pressure falls.",
        url: "https://chem.libretexts.com/water-properties",
      },
    ],
    relevant: [0, 3],
    referenceAnswer: "At sea level (1 atm), water boils at 100 °C (212 °F).",
    rubric: [
      "Gives 100 °C or 212 °F.",
      "Ties it to sea level / standard pressure (or notes it changes with altitude).",
    ],
  },
  {
    id: "magnus-effect",
    query: "what causes the curve of a spinning football (soccer)",
    results: [
      {
        title: "The Magnus effect explained",
        snippet:
          "A spinning ball drags air around it, creating a pressure difference that pushes the ball sideways, curving its path.",
        url: "https://physics-now.com/magnus-effect",
      },
      {
        title: "Football boots: 2026 lineup",
        snippet:
          "Lightweight studs and a textured surface for grip and control on any pitch.",
        url: "https://sports.com/football-boots",
      },
      {
        title: "Football (soccer) rules overview",
        snippet:
          "The basic laws of the game: offside, fouls, corners and how a match is structured.",
        url: "https://rules.com/soccer-laws",
      },
      {
        title: "Why free kicks bend - BBC Sport",
        snippet:
          "Striking the ball off-centre spins it; the resulting Magnus effect is what bends a free kick around the wall.",
        url: "https://bbc.com/sport/free-kicks",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "The curve is caused by the Magnus effect: a spinning ball creates a pressure difference in the surrounding air that pushes it sideways, bending its trajectory.",
    rubric: [
      "Names the Magnus effect or the underlying pressure difference from spin.",
      "Does not attribute the curve to air 'pushing' it in a single direction with no spin mechanism.",
    ],
  },
  {
    id: "photosynthesis-equation",
    query: "what is the chemical equation for photosynthesis",
    results: [
      {
        title: "Photosynthesis - an overview",
        snippet:
          "6 CO2 + 6 H2O + light -> C6H12O6 + 6 O2: plants convert carbon dioxide and water into glucose and oxygen.",
        url: "https://biology.com/photosynthesis",
      },
      {
        title: "Garden sunlight: how much does your plant need?",
        snippet:
          "Most houseplants do well with a few hours of indirect light a day.",
        url: "https://gardening.com/plant-light",
      },
      {
        title: "Succulent care 101",
        snippet:
          "Water less often, use a gritty mix, and give bright indirect light.",
        url: "https://plants101.com/succulents",
      },
      {
        title: "The equation of photosynthesis - Khan Academy",
        snippet:
          "Carbon dioxide plus water, using light energy, yields glucose and oxygen.",
        url: "https://khanacademy.org/photosynthesis-equation",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "6 CO2 + 6 H2O + light energy -> C6H12O6 (glucose) + 6 O2.",
    rubric: [
      "Includes CO2 and H2O as reactants and glucose (C6H12O6) and O2 as products.",
      "Mentions light (energy) as a requirement.",
    ],
  },
  {
    id: "speed-of-light",
    query: "What is the speed of light in a vacuum?",
    results: [
      {
        title: "Speed of light - Wikipedia",
        snippet:
          "The speed of light in vacuum, usually denoted c, is exactly 299,792,458 metres per second.",
        url: "https://wikipedia.org/wiki/Speed_of_light",
      },
      {
        title: "LED light bulbs: energy-saving 6-pack",
        snippet:
          "Bright, long-lasting LED bulbs for your home. Save on your electricity bill.",
        url: "https://home.com/led-bulbs",
      },
      {
        title: "Fiber internet: gigabit 'speed of light' plans",
        snippet:
          "Blazing-fast fiber up to 1 Gbps. Marketing calls it the speed of light.",
        url: "https://isp.com/fiber-gigabit",
      },
      {
        title: "The constant c in physics - HyperPhysics",
        snippet:
          "c = 299792458 m/s is the invariant speed that sets the maximum speed of causality.",
        url: "https://hyperphysics.com/speed-of-light",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "The speed of light in a vacuum is exactly 299,792,458 metres per second (about 3.00 x 10^8 m/s).",
    rubric: [
      "Gives 299,792,458 m/s or about 3.00 x 10^8 m/s.",
      "Does not give the speed of light in air or glass as the vacuum value.",
    ],
  },
  {
    id: "mona-lisa-painter",
    query: "Who painted the Mona Lisa?",
    results: [
      {
        title: "Mona Lisa - The Louvre",
        snippet:
          "La Joconde, by Leonardo da Vinci, painted in the early 16th century, is the museum's most visited work.",
        url: "https://louvre.fr/mona-lisa",
      },
      {
        title: "Mona Lisa Halloween masks and costumes",
        snippet:
          "Be the enigma this Halloween with our best-selling Mona Lisa mask.",
        url: "https://costumes.com/mona-lisa-mask",
      },
      {
        title: "Mona Lisa (singer): discography",
        snippet:
          "A French singer-songwriter's albums, singles and touring dates.",
        url: "https://music.com/mona-lisa-singer",
      },
      {
        title: "Mona Lisa - Wikipedia",
        snippet:
          "The Mona Lisa is a portrait painting by the Italian Renaissance artist Leonardo da Vinci.",
        url: "https://wikipedia.org/wiki/Mona_Lisa",
      },
    ],
    relevant: [0, 3],
    referenceAnswer: "The Mona Lisa was painted by Leonardo da Vinci.",
    rubric: [
      "Names Leonardo da Vinci as the painter.",
      "Does not confuse the painting with a person or artist of the same name.",
    ],
  },
  {
    id: "baking-soda-vs-powder",
    query: "difference between baking soda and baking powder",
    results: [
      {
        title: "Baking soda vs baking powder, explained",
        snippet:
          "Baking soda is pure sodium bicarbonate and needs an acid to react; baking powder already has an acid added.",
        url: "https://cooking-science.com/soda-vs-powder",
      },
      {
        title: "Arm & Hammer baking soda, 4 lb",
        snippet:
          "Multipurpose baking soda for baking, cleaning and deodorizing.",
        url: "https://grocery.com/baking-soda-4lb",
      },
      {
        title: "Classic lemon drizzle cake recipe",
        snippet: "A moist lemon cake with a sweet drizzle topping. Serves 10.",
        url: "https://recipes.com/lemon-drizzle",
      },
      {
        title: "What is the difference? - wikiHow",
        snippet:
          "Baking powder contains baking soda plus an acid and starch, so it leavens on its own.",
        url: "https://wikihow.com/baking-soda-vs-powder",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "Baking soda is sodium bicarbonate alone and needs an acid to leaven; baking powder is baking soda plus a built-in acid (and usually starch), so it leavens by itself.",
    rubric: [
      "Notes baking soda needs an acid to react.",
      "Notes baking powder already contains an acid (works on its own).",
    ],
  },
  {
    id: "tallest-mountain",
    query: "What is the tallest mountain in the world?",
    results: [
      {
        title: "Mount Everest - Wikipedia",
        snippet:
          "Everest, at 8,849 m, is Earth's highest mountain above sea level, on the Nepal-Tibet border.",
        url: "https://wikipedia.org/wiki/Mount_Everest",
      },
      {
        title: "Everest base camp trekking tours",
        snippet:
          "14-day guided trek to Everest base camp. Flights and guides included.",
        url: "https://treks.com/everest-base-camp",
      },
      {
        title: "Mountain bike sale: full-suspension",
        snippet: "Trail-ready full-suspension mountain bikes, from $699.",
        url: "https://cycles.com/mountain-bike",
      },
      {
        title: "Highest peaks on Earth - Britannica",
        snippet:
          "Mount Everest is the highest mountain above sea level at 8,848.86 m.",
        url: "https://britannica.com/highest-peaks",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "Mount Everest is the tallest mountain in the world (highest above sea level), at about 8,849 m.",
    rubric: [
      "Names Mount Everest as the tallest mountain.",
      "Gives an elevation near 8,849 m (or 8,848 m), or at least identifies Everest correctly.",
    ],
  },
  {
    id: "change-car-tire",
    query: "how to change a flat car tire",
    results: [
      {
        title: "How to Change a Flat Tire - AAA",
        snippet:
          "Park safely, put on the handbrake, loosen the lug nuts, jack up the car, and swap in the spare.",
        url: "https://aaa.com/change-a-flat",
      },
      {
        title: "All-season tires: price comparison",
        snippet: "Compare prices for popular all-season tires in your size.",
        url: "https://tires.com/all-season-prices",
      },
      {
        title: "Alloy wheel accessories and caps",
        snippet:
          "Decorative wheel covers and valve caps to finish off your rims.",
        url: "https://auto.com/wheel-caps",
      },
      {
        title: "Spare tire change step by step - YouTube",
        snippet:
          "A 3-minute video walking through jacking, swapping and tightening the lug nuts.",
        url: "https://youtube.com/watch/change-flat",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "Park on level ground, set the handbrake, loosen the lug nuts, jack up the car, remove the flat, fit the spare, tighten the nuts, and lower the car.",
    rubric: [
      "Mentions jacking the car up.",
      "Mentions loosening/removing the lug nuts and fitting the spare.",
      "Mentions a safety step (handbrake / parking on level ground).",
    ],
  },
  {
    id: "first-iphone-year",
    query: "What year did the first iPhone release?",
    results: [
      {
        title: "iPhone - Wikipedia",
        snippet:
          "The original iPhone was announced in January 2007 and released in the United States on June 29, 2007.",
        url: "https://wikipedia.org/wiki/IPhone",
      },
      {
        title: "iPhone 16 Pro review: is it worth it?",
        snippet:
          "Our full review of the latest flagship, two years after its launch.",
        url: "https://techreview.com/iphone-16-pro",
      },
      {
        title: "iPhone cases and screen protectors",
        snippet:
          "Shop rugged cases and tempered-glass protectors for every iPhone model.",
        url: "https://cases.com/iphone",
      },
      {
        title: "Apple unveils iPhone - Apple Newsroom (2007)",
        snippet:
          "Today Apple reinvented the phone. The iPhone combines three revolutionary devices.",
        url: "https://apple.com/newsroom/2007-iphone",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "The first iPhone was released in 2007 (announced January 2007, released June 29, 2007).",
    rubric: [
      "Gives 2007 as the release year.",
      "Does not give a different year.",
    ],
  },
  {
    id: "reset-wifi-router",
    query: "how do I reset my Wi-Fi router to factory settings",
    results: [
      {
        title: "Factory reset your router - ISP support",
        snippet:
          "Press and hold the recessed reset button for about 10 seconds until the lights blink.",
        url: "https://isp.com/factory-reset-router",
      },
      {
        title: "Mesh Wi-Fi system review: 3-pack",
        snippet:
          "Whole-home coverage from three nodes. Our verdict after a month.",
        url: "https://techreview.com/mesh-wifi",
      },
      {
        title: "Cable modem and router bundles",
        snippet: "Save with a combo modem-router for your home internet.",
        url: "https://isp.com/modem-router-bundle",
      },
      {
        title: "How to factory reset any router - CNET",
        snippet:
          "Find the reset pinhole, hold it with a paperclip until the status light flashes, and reconfigure.",
        url: "https://cnet.com/router-factory-reset",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "Press and hold the router's recessed reset button (with a paperclip) for about 10 seconds until the lights blink, which restores factory defaults.",
    rubric: [
      "Mentions the physical reset button (pinhole / recessed).",
      "Mentions holding it for several (about 10) seconds.",
      "Notes that it restores factory defaults / requires reconfiguration.",
    ],
  },
  {
    id: "gold-chemical-symbol",
    query: "What is the chemical symbol for gold?",
    results: [
      {
        title: "Gold - Wikipedia",
        snippet:
          "Gold is a chemical element with symbol Au and atomic number 79.",
        url: "https://wikipedia.org/wiki/Gold",
      },
      {
        title: "14k gold jewelry: rings and chains",
        snippet: "Shop fine 14k gold jewelry. Free shipping on all orders.",
        url: "https://jewelry.com/gold-rings",
      },
      {
        title: "Gold Rewards credit card benefits",
        snippet: "Earn points on every purchase with the Gold Rewards card.",
        url: "https://bank.com/gold-card",
      },
      {
        title: "The Periodic Table: Au (gold)",
        snippet:
          "Au, atomic number 79, a transition metal widely used in electronics.",
        url: "https://periodic-table.com/au",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "The chemical symbol for gold is Au (from the Latin 'aurum').",
    rubric: [
      "Gives Au as the chemical symbol for gold.",
      "Does not give the symbol for a different element.",
    ],
  },
  {
    id: "remove-stain-white-shirt",
    query: "how to remove a stain from a white shirt",
    results: [
      {
        title: "Stains: A History of Dirt and Cleanliness",
        snippet:
          "A cultural history of why we care about clean clothes. Hardcover, 320 pages.",
        url: "https://books.com/stains-history",
      },
      {
        title: "How to Remove Common Stains from Clothes - wikiHow",
        snippet:
          "Treat ink, wine, grass and grease stains with the right solvent before washing.",
        url: "https://wikihow.com/remove-clothing-stains",
      },
      {
        title: "Dry cleaning services near you",
        snippet: "Book a same-week dry clean and press for your garments.",
        url: "https://cleaners.com/near-you",
      },
      {
        title: "Removing ink, wine, and oil from white fabric",
        snippet:
          "Step-by-step for white shirts: dab, don't rub, and pre-treat before the wash.",
        url: "https://fabriccare.com/white-shirt-stains",
      },
    ],
    relevant: [1, 3],
    referenceAnswer:
      "Dab (don't rub) the stain, pre-treat it with a suitable solvent or stain remover, then wash; for white cotton you can also use oxygen bleach.",
    rubric: [
      "Recommends treating/pre-treating the stain before washing.",
      "Gives a concrete method (dabbing, a solvent/remover, or oxygen bleach for whites).",
    ],
  },
  {
    id: "capital-of-canada",
    query: "what is the capital of canada",
    results: [
      {
        title: "Canada: the ultimate travel guide",
        snippet: "Top 20 places to visit, from the Rockies to the East Coast.",
        url: "https://travel.com/canada-guide",
      },
      {
        title: "Capital of Canada - Wikipedia",
        snippet: "Ottawa is the capital city of Canada.",
        url: "https://wikipedia.org/wiki/Capital_of_Canada",
      },
      {
        title: "Apply for a Canadian passport",
        snippet: "Start or renew your passport application online.",
        url: "https://canada.ca/passport",
      },
      {
        title: "Ottawa, the capital of Canada",
        snippet: "Ottawa, in Ontario, has been Canada's capital since 1859.",
        url: "https://ottawa.ca/capital",
      },
    ],
    relevant: [1, 3],
    referenceAnswer: "The capital of Canada is Ottawa.",
    rubric: [
      "Names Ottawa as the capital of Canada.",
      "Does not name a non-capital Canadian city (e.g. Toronto or Vancouver).",
    ],
  },
  {
    id: "budget-laptop-students",
    query: "best budget laptop for students 2024",
    results: [
      {
        title: "Laptop repair and parts store",
        snippet:
          "Fix your broken laptop. Screens, keyboards and batteries in stock.",
        url: "https://repairs.com/laptop-parts",
      },
      {
        title: "Best budget laptops for students in 2024",
        snippet:
          "Our top affordable picks for note-taking and streaming, under $600.",
        url: "https://techreview.com/budget-laptops-students",
      },
      {
        title: "Laptop insurance plans compared",
        snippet:
          "Protect your device against accidental damage. From $9 a month.",
        url: "https://insurance.com/laptop",
      },
      {
        title: "Top 5 affordable laptops for college",
        snippet:
          "Long battery life and a comfortable keyboard matter most to students.",
        url: "https://collegegear.com/affordable-laptops",
      },
    ],
    relevant: [1, 3],
    referenceAnswer:
      "For students on a budget in 2024, pick a sub-$600 laptop with at least 8 GB of RAM, an SSD, and long battery life, as in the budget-student roundups.",
    rubric: [
      "Recommends a budget/affordable laptop or gives budget-laptop criteria (price, RAM, battery).",
      "Does not answer with a repair service or an insurance plan.",
    ],
  },
  {
    id: "halcyon-robotics-founding",
    query: "When was the Halcyon Robotics Institute founded?",
    results: [
      {
        title: "Halcyon Robotics Institute - About Us",
        snippet:
          "Founded in 1987, the Halcyon Robotics Institute develops autonomous systems and robotics research.",
        url: "https://halcyonrobotics.org/about",
      },
      {
        title: "Robotics career fair 2024",
        snippet:
          "Meet employers in robotics and AI. Register for the fall career fair.",
        url: "https://careers.com/robotics-fair",
      },
      {
        title: "Robot building kits for kids",
        snippet: "Snap-together robot kits, ages 8 and up. Ships free.",
        url: "https://toys.com/robot-kits",
      },
      {
        title: "Halcyon Robotics Institute - Wikipedia",
        snippet:
          "The Halcyon Robotics Institute (HRI) is a research organization founded in 1987.",
        url: "https://wikipedia.org/wiki/Halcyon_Robotics_Institute",
      },
    ],
    relevant: [0, 3],
    referenceAnswer: "The Halcyon Robotics Institute was founded in 1987.",
    rubric: [
      "States 1987 as the founding year.",
      "Does not give a different year or say it is unknown.",
    ],
    snippetOnly: true,
  },
  {
    id: "nimbus-t3-battery",
    query: "how many hours of battery life does the Nimbus T3 laptop have",
    results: [
      {
        title: "Nimbus T3 review: all-day and then some",
        snippet:
          "The Nimbus T3 gets 22 hours of battery life on a single charge in our tests.",
        url: "https://techreview.com/nimbus-t3",
      },
      {
        title: "Laptop stands and cooling pads",
        snippet: "Ergonomic aluminum laptop stands, from $29.",
        url: "https://gadgets.com/laptop-stands",
      },
      {
        title: "USB-C chargers and adapters",
        snippet: "65W and 100W GaN chargers for laptops and phones.",
        url: "https://gadgets.com/usb-c-chargers",
      },
      {
        title: "Nimbus T3 specifications",
        snippet:
          "Battery: up to 22 hours of video playback on a single charge.",
        url: "https://nimbuspc.com/t3-specs",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "The Nimbus T3 laptop has up to 22 hours of battery life on a single charge.",
    rubric: [
      "States 22 hours of battery life.",
      "Does not give a different battery figure.",
    ],
    snippetOnly: true,
  },
  {
    id: "gale-7-drone-payload",
    query: "what is the maximum payload of the Gale-7 survey drone",
    results: [
      {
        title: "Gale-7 specifications",
        snippet: "Maximum payload 6.2 kg; flight time up to 40 minutes.",
        url: "https://galeaero.com/gale-7-specs",
      },
      {
        title: "Drone insurance and registration",
        snippet:
          "Register your drone and get liability coverage from $15 a month.",
        url: "https://drones.com/insurance",
      },
      {
        title: "Camera gimbals for drones",
        snippet: "3-axis gimbals for 4K cameras, from $199.",
        url: "https://dronegear.com/gimbals",
      },
      {
        title: "Gale-7 review: built for surveying",
        snippet: "The Gale-7 carries up to 6.2 kg of survey equipment.",
        url: "https://geospatial.com/gale-7-review",
      },
    ],
    relevant: [0, 3],
    referenceAnswer:
      "The Gale-7 survey drone carries a maximum payload of 6.2 kg.",
    rubric: [
      "States 6.2 kg as the maximum payload.",
      "Does not give a different payload figure.",
    ],
    snippetOnly: true,
  },
];
