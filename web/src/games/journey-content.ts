/**
 * Story content for the History journey game. Each depth study / core section has its own route
 * and setting; the scenes are everyday reporter situations, deliberately free of historical
 * claims, so the only facts in the game are the checked recall cards. Place names were chosen
 * because they kept the same name through the whole period (no St Petersburg/Petrograd/Leningrad
 * problems); keep it that way when adding routes.
 */

export const GAME_NAME = "Dispatches";

export interface Setting {
  /** Who the student plays and where they're sent. */
  intro: string;
  /** Stops in order; the last one is the destination where the story is filed. */
  route: string[];
}

const PAPER = "the London Courier"; // fictional paper

export const SETTINGS: Record<string, Setting> = {
  germany: {
    intro: `You're a young foreign correspondent for ${PAPER}, sent to report on Germany. Travel north from Munich and file your story in Berlin.`,
    route: ["Munich", "Augsburg", "Nuremberg", "Weimar", "Jena", "Leipzig", "Dresden", "Magdeburg", "Potsdam", "Berlin"],
  },
  russia: {
    intro: `You're a young foreign correspondent for ${PAPER}, sent to report on Russia. Cross the country by rail from Vladivostok and file your story in Moscow.`,
    route: ["Vladivostok", "Khabarovsk", "Chita", "Irkutsk", "Krasnoyarsk", "Tomsk", "Omsk", "Tyumen", "Kazan", "Moscow"],
  },
  usa: {
    intro: `You're a young foreign correspondent for ${PAPER}, sent to report on America. Cross the country from Los Angeles and file your story in New York.`,
    route: ["Los Angeles", "Phoenix", "Albuquerque", "Amarillo", "Oklahoma City", "Kansas City", "St. Louis", "Chicago", "Pittsburgh", "New York"],
  },
  interwar: {
    intro: `You're a young diplomatic correspondent for ${PAPER}, following the statesmen of Europe. Tour the capitals and file your story in Geneva.`,
    route: ["London", "Paris", "Brussels", "Berlin", "Warsaw", "Prague", "Vienna", "Rome", "Milan", "Geneva"],
  },
  "cold-war": {
    intro: `You're a young foreign correspondent for ${PAPER}, covering the superpowers. Travel from Washington across Europe and file your story in Moscow.`,
    route: ["Washington", "London", "Bonn", "Berlin", "Prague", "Vienna", "Budapest", "Warsaw", "Helsinki", "Moscow"],
  },
};

/** Used for any section without its own setting (other subjects later, mixed runs). */
export const DEFAULT_SETTING: Setting = {
  intro: `You're a young correspondent for ${PAPER}. Travel the route, check your facts at every stop and file your story at the end.`,
  route: ["Dover", "Calais", "Paris", "Lyon", "Geneva", "Turin", "Milan", "Verona", "Venice", "Trieste"],
};

export type Effect = Partial<Record<"funds" | "stamina" | "trust" | "contacts" | "days", number>>;

/** A scene at a stop. The card question is the fact to check; the effects follow the answer. */
export interface Scene {
  id: string;
  /** {place} is replaced with the stop's name. */
  text: string;
  right: { text: string; effect: Effect };
  wrong: { text: string; effect: Effect };
}

export const SCENES: Scene[] = [
  {
    id: "telegraph",
    text: "At the telegraph office in {place} you're about to wire your first notes to London. Check this fact before you pay for the words.",
    right: { text: "The editor wires back: \"Good, accurate copy.\"", effect: { trust: 1 } },
    wrong: { text: "The editor wires back a correction. Not a good look.", effect: { trust: -1 } },
  },
  {
    id: "rival",
    text: "In a café in {place}, a reporter from a rival paper bets you a week's expenses you can't answer this.",
    right: { text: "You win the bet. Your rival pays up, grumbling.", effect: { funds: 3 } },
    wrong: { text: "You lose the bet and pay up.", effect: { funds: -2 } },
  },
  {
    id: "library",
    text: "The librarian in {place} will open the newspaper archive to serious researchers. She tests you first.",
    right: { text: "She's impressed and gives you a letter of introduction to a professor.", effect: { contacts: 1 } },
    wrong: { text: "She sends you to read the guidebooks instead. You lose a day.", effect: { days: 1 } },
  },
  {
    id: "notebook",
    text: "Your notebook got soaked in the rain on the way into {place}. Rewrite this note from memory.",
    right: { text: "Your notes are as good as new.", effect: { trust: 1 } },
    wrong: { text: "You file a muddled note, and the subeditors spot it.", effect: { trust: -1 } },
  },
  {
    id: "expenses",
    text: "The editor calls from London while you're in {place}. Before approving your expenses, he checks you know your subject.",
    right: { text: "\"Fine, claim it.\" Your expenses are approved.", effect: { funds: 2 } },
    wrong: { text: "\"Do your homework.\" No expenses this week, and he's less sure of you.", effect: { trust: -1 } },
  },
  {
    id: "photographer",
    text: "A photographer in {place} will team up with you, but only with a reporter who knows the story.",
    right: { text: "You shake hands. Her pictures will make your story stand out.", effect: { trust: 1, contacts: 1 } },
    wrong: { text: "She decides to work for someone else.", effect: {} },
  },
  {
    id: "briefing",
    text: "At a press briefing in {place}, everyone wants a sharp question. Get the fact right and you'll get the headline.",
    right: { text: "Your question lands. The other reporters copy your notes.", effect: { trust: 2 } },
    wrong: { text: "Your question falls flat, and the room laughs.", effect: { trust: -1, stamina: -1 } },
  },
  {
    id: "hotel",
    text: "The hotel in {place} runs a quiz night for its guests. The prize is a free room.",
    right: { text: "You win a free night, a hot bath and a good sleep.", effect: { stamina: 1, funds: 1 } },
    wrong: { text: "No prize, and the room is expensive.", effect: { funds: -1 } },
  },
  {
    id: "student",
    text: "On the train into {place}, a history student wants to argue all night. Hold your own on this.",
    right: { text: "You win the argument and then sleep well.", effect: { stamina: 1 } },
    wrong: { text: "You lose the argument and lie awake going over it.", effect: { stamina: -1 } },
  },
  {
    id: "papers",
    text: "An official in {place} checks your press pass, and asks you a question to prove you're really a reporter.",
    right: { text: "He stamps your pass and waves you through.", effect: {} },
    wrong: { text: "He keeps you waiting while he checks with his office. Two days lost.", effect: { days: 2 } },
  },
  {
    id: "editor-letter",
    text: "A reader's letter waiting for you in {place} says your last piece got a fact wrong. Did it?",
    right: { text: "You reply with the facts. The editor prints your answer.", effect: { trust: 1 } },
    wrong: { text: "You can't be sure, so the paper prints an apology.", effect: { trust: -1 } },
  },
  {
    id: "museum",
    text: "The museum curator in {place} offers you a private tour if you can name this.",
    right: { text: "The tour gives you a great detail for your story, and a new contact.", effect: { contacts: 1 } },
    wrong: { text: "The tour is booked up. Tomorrow, perhaps.", effect: { days: 1 } },
  },
];

/** The last stop always uses this scene. */
export const FINAL_SCENE: Scene = {
  id: "front-page",
  text: "You reach {place}. The story is written. One last fact to check before the subeditor sets your headline.",
  right: { text: "The fact checks out. Your story goes to the printers.", effect: { trust: 2 } },
  wrong: { text: "The subeditor catches the mistake just in time, and your story is cut.", effect: { trust: -2 } },
};

/** Small things that can happen on the road. They never involve facts. */
export const INCIDENTS: Array<{ text: string; effect: Effect }> = [
  { text: "A fellow passenger shares their lunch with you.", effect: { stamina: 1 } },
  { text: "A local paper buys a short piece from you.", effect: { funds: 2 } },
  { text: "A friendly porter introduces you to a cousin who knows everyone.", effect: { contacts: 1 } },
  { text: "Your wallet is stolen at a station.", effect: { funds: -2 } },
  { text: "A cold, draughty journey. You catch a chill.", effect: { stamina: -1 } },
  { text: "Floods on the line. You're held up for a day.", effect: { days: 1 } },
];
