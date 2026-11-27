/**
 * Story content for Dispatches. The student is a young correspondent on a fictional paper, and
 * each subject has its own desk: History, Science, Tech and Data (Add Maths).
 *
 * The scenes are everyday reporter situations and deliberately make NO subject claims, so the only
 * facts in the game are the checked recall cards. Keep it that way when adding scenes. Place names
 * on the History routes were chosen because they kept the same name through the whole period (no
 * St Petersburg/Petrograd/Leningrad problems); keep that too.
 */

export const GAME_NAME = "Dispatches";

export type Desk = "history" | "science" | "tech" | "data";

export const DESK_FOR_CODE: Record<string, Desk> = { "0977": "history", "0973": "science", "0984": "tech", "0606": "data" };

export function deskFor(code: string): Desk {
  return DESK_FOR_CODE[code] ?? "history";
}

export interface Setting {
  /** Who the student plays and where they're sent. */
  intro: string;
  /** Stops in order; the last one is the destination where the story is filed. */
  route: string[];
}

const PAPER = "the London Courier"; // fictional paper

/** History settings, one per section of the syllabus. */
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

/** One setting per subject for the other desks (any section of the subject). */
export const SUBJECT_SETTINGS: Record<string, Setting> = {
  "0973": {
    intro: `You've just joined the Science desk at ${PAPER}. Tour the country's labs, hospitals and power stations and file a feature in London.`,
    route: ["Edinburgh", "Newcastle", "York", "Manchester", "Liverpool", "Birmingham", "Bristol", "Oxford", "Cambridge", "London"],
  },
  "0984": {
    intro: `You've just joined the Tech desk at ${PAPER}. Visit start-ups, data centres and coding clubs across Europe and file your story in London.`,
    route: ["Helsinki", "Stockholm", "Copenhagen", "Hamburg", "Amsterdam", "Brussels", "Paris", "Dublin", "Manchester", "London"],
  },
  "0606": {
    intro: `You've just joined the Data desk at ${PAPER}, where every story lives or dies by its numbers. Travel the country and file your story in London.`,
    route: ["Aberdeen", "Dundee", "Glasgow", "Belfast", "Leeds", "Sheffield", "Nottingham", "Leicester", "Reading", "London"],
  },
};

/** Used for anything without its own setting. */
export const DEFAULT_SETTING: Setting = {
  intro: `You're a young correspondent for ${PAPER}. Travel the route, check your facts at every stop and file your story at the end.`,
  route: ["Dover", "Calais", "Paris", "Lyon", "Geneva", "Turin", "Milan", "Verona", "Venice", "Trieste"],
};

export function settingFor(code: string, sectionId: string): Setting {
  if (deskFor(code) === "history") return SETTINGS[sectionId] ?? DEFAULT_SETTING;
  return SUBJECT_SETTINGS[code] ?? DEFAULT_SETTING;
}

export type Effect = Partial<Record<"funds" | "stamina" | "trust" | "contacts" | "days", number>>;

/** A scene at a stop. The card question is the fact to check; the effects follow the answer. */
export interface Scene {
  id: string;
  /** {place} is replaced with the stop's name. */
  text: string;
  right: { text: string; effect: Effect };
  wrong: { text: string; effect: Effect };
  /** Desks the scene suits; every desk if missing. */
  desks?: Desk[];
}

const S = (id: string, text: string, right: [string, Effect], wrong: [string, Effect], desks?: Desk[]): Scene => ({
  id,
  text,
  right: { text: right[0], effect: right[1] },
  wrong: { text: wrong[0], effect: wrong[1] },
  desks,
});

export const SCENES: Scene[] = [
  // ---- any desk ----
  S("telegraph", "At the telegraph office in {place} you're about to wire your first notes to London. Check this fact before you pay for the words.",
    ["The editor wires back: \"Good, accurate copy.\"", { trust: 1 }], ["The editor wires back a correction. Not a good look.", { trust: -1 }], ["history"]),
  S("phone-in", "You phone your notes through to London from a hotel in {place}. The copy-taker reads one back to check it.",
    ["\"Got it, word for word.\" The story is set for the morning edition.", { trust: 1 }], ["You correct yourself halfway through. The subeditor sighs.", { trust: -1 }], ["science", "tech", "data"]),
  S("rival", "In a café in {place}, a reporter from a rival paper bets you a week's expenses you can't answer this.",
    ["You win the bet. Your rival pays up, grumbling.", { funds: 3 }], ["You lose the bet and pay up.", { funds: -2 }]),
  S("library", "The librarian in {place} will open the archive to serious researchers. She tests you first.",
    ["She's impressed and gives you a letter of introduction to a professor.", { contacts: 1 }], ["She sends you to read the guidebooks instead. You lose a day.", { days: 1 }]),
  S("notebook", "Your notebook got soaked in the rain on the way into {place}. Rewrite this note from memory.",
    ["Your notes are as good as new.", { trust: 1 }], ["You file a muddled note, and the subeditors spot it.", { trust: -1 }]),
  S("expenses", "The editor calls from London while you're in {place}. Before approving your expenses, he checks you know your subject.",
    ["\"Fine, claim it.\" Your expenses are approved.", { funds: 2 }], ["\"Do your homework.\" No expenses this week, and he's less sure of you.", { trust: -1 }]),
  S("photographer", "A photographer in {place} will team up with you, but only with a reporter who knows the story.",
    ["You shake hands. Her pictures will make your story stand out.", { trust: 1, contacts: 1 }], ["She decides to work for someone else.", {}]),
  S("briefing", "At a press briefing in {place}, everyone wants a sharp question. Get the fact right and you'll get the headline.",
    ["Your question lands. The other reporters copy your notes.", { trust: 2 }], ["Your question falls flat, and the room laughs.", { trust: -1, stamina: -1 }]),
  S("hotel", "The hotel in {place} runs a quiz night for its guests. The prize is a free room.",
    ["You win a free night, a hot bath and a good sleep.", { stamina: 1, funds: 1 }], ["No prize, and the room is expensive.", { funds: -1 }]),
  S("student", "On the train into {place}, a student wants to argue all night. Hold your own on this.",
    ["You win the argument and then sleep well.", { stamina: 1 }], ["You lose the argument and lie awake going over it.", { stamina: -1 }]),
  S("papers", "An official in {place} checks your press pass, and asks you a question to prove you're really a reporter.",
    ["He stamps your pass and waves you through.", {}], ["He keeps you waiting while he checks with his office. Two days lost.", { days: 2 }]),
  S("editor-letter", "A reader's letter waiting for you in {place} says your last piece got a fact wrong. Did it?",
    ["You reply with the facts. The editor prints your answer.", { trust: 1 }], ["You can't be sure, so the paper prints an apology.", { trust: -1 }]),
  S("museum", "The museum curator in {place} offers you a private tour if you can name this.",
    ["The tour gives you a great detail for your story, and a new contact.", { contacts: 1 }], ["The tour is booked up. Tomorrow, perhaps.", { days: 1 }]),
  S("radio", "A radio station in {place} invites you on air for a live quiz with listeners.",
    ["You're a hit. The station pays you a small fee.", { funds: 2 }], ["You fumble live on air. Your editor was listening.", { trust: -1 }]),
  S("tutor", "A retired teacher in {place} offers to read your draft, if you can answer her question first.",
    ["She tidies up your draft over tea and cake.", { trust: 1, stamina: 1 }], ["She sighs and hands the draft back unread.", {}]),
  S("schoolkids", "A class of schoolchildren in {place} wants to interview a real reporter. One of them asks you this.",
    ["The children cheer. Their teacher writes to your paper to say thank you.", { trust: 1 }], ["A ten-year-old corrects you. Everyone laughs, including you.", { stamina: -1 }]),
  S("market", "A stallholder in {place} will give you breakfast free if you can answer her question.",
    ["A free breakfast and directions to the best café in town.", { stamina: 1 }], ["You pay for breakfast like everyone else.", { funds: -1 }]),
  S("taxi", "A taxi driver in {place} knows everyone in town. He'll introduce you if you pass his test.",
    ["He drops you off with a name and a phone number.", { contacts: 1 }], ["He drives you the long way round and charges for it.", { funds: -1 }]),
  S("deadline", "It's an hour to deadline in {place}, and the subeditor needs one fact confirmed, fast.",
    ["Confirmed in seconds. The subeditor buys you a coffee.", { trust: 1 }], ["The page goes out with a gap where your fact should be.", { trust: -1 }]),
  S("translator", "Your translator in {place} is unsure about a term. She asks you to check it.",
    ["She's impressed, and lets you off her fee for the day.", { funds: 2 }], ["You get it muddled, and the interview has to be done again.", { days: 1 }]),
  S("bookshop", "The owner of a bookshop in {place} has a rare book for your research. He wants to know you're serious.",
    ["He lends it to you for nothing.", { trust: 1 }], ["He sells it to you, at a price.", { funds: -2 }]),
  S("rival-scoop", "A rival paper in {place} is about to print a story with a mistake. Spot the right answer and you beat them to it.",
    ["Your paper prints the right version first. A scoop!", { trust: 2 }], ["You go with their version. Both papers print a correction.", { trust: -1 }]),
  S("delayed-train", "Your train is stuck outside {place}. A fellow passenger passes the time with a question.",
    ["Time flies. You arrive cheerful and rested.", { stamina: 1 }], ["The wait drags on, and you arrive worn out.", { stamina: -1 }]),
  S("lecture", "You slip into a public lecture in {place}. The speaker asks the audience this.",
    ["You answer, and the speaker gives you an interview afterwards.", { contacts: 1 }], ["Someone else answers. You leave with nothing new.", {}]),
  S("competition", "A newspaper in {place} runs a reader's competition. The prize is a cash award.",
    ["You win, under a pen name. The prize helps.", { funds: 3 }], ["Not this time.", {}]),
  S("archivist", "A town archivist in {place} has boxes of documents, but only for someone who knows the field.",
    ["You spend a happy afternoon among the boxes and find a gem.", { trust: 1 }], ["The archivist shakes her head. You lose a day on paperwork.", { days: 1 }]),
  // ---- History desk ----
  S("veteran", "An old man in a café in {place} remembers those days. He'll talk to you if you can show you know your history.",
    ["He talks for hours. Your story comes alive.", { trust: 1, contacts: 1 }], ["He goes back to his newspaper.", {}], ["history"]),
  S("documents", "A dealer in {place} offers you a bundle of old papers. Check one detail before you buy.",
    ["The detail checks out. A real find.", { trust: 1 }], ["You buy them anyway. They turn out to be worthless copies.", { funds: -2 }], ["history"]),
  S("diplomat", "At an embassy reception in {place}, a diplomat tests the young reporter.",
    ["He's impressed, and promises to take your calls.", { contacts: 1 }], ["He moves on to someone more interesting.", {}], ["history"]),
  // ---- Science desk ----
  S("lab", "A lab technician in {place} will show you round, but only once you've answered her question.",
    ["The tour gives you a great opening paragraph.", { trust: 1 }], ["She sends you back to reception for a day.", { days: 1 }], ["science"]),
  S("hospital", "A doctor at the hospital in {place} has five minutes between patients. Use them well.",
    ["She gives you a great quote and her direct number.", { contacts: 1 }], ["Her pager goes off. Interview over.", {}], ["science"]),
  S("power-station", "The engineer at the power station outside {place} quizzes visitors at the gate.",
    ["You get the full tour, hard hat and all.", { trust: 1 }], ["You get the visitor leaflet and a long walk back.", { stamina: -1 }], ["science"]),
  S("science-fair", "You're asked to judge a school science fair in {place}. One of the pupils tests you first.",
    ["The pupils cheer. A heart-warming side story for the paper.", { trust: 1, stamina: 1 }], ["The pupil politely puts you right.", {}], ["science"]),
  // ---- Tech desk ----
  S("startup", "The founder of a start-up in {place} will give you an exclusive, if you can keep up.",
    ["You get the exclusive and her number.", { trust: 1, contacts: 1 }], ["She gives the story to a tech blog instead.", {}], ["tech"]),
  S("hackathon", "You drop into a weekend hackathon in {place}. A team asks you to settle an argument.",
    ["They name their project after you. Great colour for your piece.", { trust: 1 }], ["They politely go back to their screens.", {}], ["tech"]),
  S("data-centre", "Security at the data centre in {place} asks every visitor a question before letting them in.",
    ["Badge issued. You're in.", {}], ["You wait outside while they check your booking. Two days lost.", { days: 2 }], ["tech"]),
  S("coding-club", "The volunteers at a coding club in {place} want a guest speaker who knows the basics.",
    ["The talk goes well, and they pay your travel.", { funds: 2 }], ["A twelve-year-old points out your mistake.", { stamina: -1 }], ["tech"]),
  // ---- Data desk (Add Maths) ----
  S("statistician", "A government statistician in {place} only talks to reporters who know their maths.",
    ["She explains the figures behind your story.", { trust: 1, contacts: 1 }], ["She hands you a press release instead.", {}], ["data"]),
  S("bookmaker", "A bookmaker in {place} bets you can't answer this straight off.",
    ["You win the bet and keep your wits.", { funds: 3 }], ["The house wins, as usual.", { funds: -2 }], ["data"]),
  S("engineer", "A bridge engineer in {place} explains the numbers behind her design, if you can follow her.",
    ["You follow every step. Your piece will be spot on.", { trust: 1 }], ["You nod along, but your notes are a mess.", { trust: -1 }], ["data"]),
  S("pollster", "A pollster in {place} shares early results with reporters who can read them properly.",
    ["You get the numbers a day early.", { trust: 2 }], ["He keeps them for the next reporter.", {}], ["data"]),
];

/** The last stop always uses this scene. */
export const FINAL_SCENE: Scene = {
  id: "front-page",
  text: "You reach {place}. The story is written. One last fact to check before the subeditor sets your headline.",
  right: { text: "The fact checks out. Your story goes to the printers.", effect: { trust: 2 } },
  wrong: { text: "The subeditor catches the mistake just in time, and your story is cut.", effect: { trust: -2 } },
};

/** Shown before the second card of a two-part stop. */
export const FOLLOW_UP_TEXT = "Your source has one more detail. Check it too: get both right for a scoop.";
export const FOLLOW_UP_BOTH = "Both facts check out. That's a scoop!";
export const FOLLOW_UP_HALF = "Half right. The editor runs it, with a note to be more careful.";

/** Small things that can happen on the road. They never involve facts. */
export const INCIDENTS: Array<{ text: string; effect: Effect }> = [
  { text: "A fellow passenger shares their lunch with you.", effect: { stamina: 1 } },
  { text: "A local paper buys a short piece from you.", effect: { funds: 2 } },
  { text: "A friendly porter introduces you to a cousin who knows everyone.", effect: { contacts: 1 } },
  { text: "You find a quiet carriage and sleep the whole way.", effect: { stamina: 1 } },
  { text: "An old colleague pays for your dinner.", effect: { funds: 1 } },
  { text: "Your wallet is stolen at a station.", effect: { funds: -2 } },
  { text: "A cold, draughty journey. You catch a chill.", effect: { stamina: -1 } },
  { text: "Floods on the line. You're held up for a day.", effect: { days: 1 } },
  { text: "You miss your connection and sleep on a bench.", effect: { stamina: -1, days: 1 } },
];
